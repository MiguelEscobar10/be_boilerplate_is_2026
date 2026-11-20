import { HttpException, Injectable, Logger } from '@nestjs/common';
import { AvisosService, ModuloOrigen, type Aviso } from '@Notifications';
import type { SimulatedPayment } from '@PrismaClient';
import { PagoSimuladoResponseDto, UltimoPagoResponseDto } from '@Payments/dto';
import {
  conflictoPago,
  pagoNoRegistrado,
  reservaNoEncontrada,
  tarjetaNoValida,
} from '@Payments/errors';
import {
  PagoRepository,
  type IntentoRegistrado,
  type ReservaParaPago,
} from '@Payments/repositories';
import { PasarelaSimuladaService } from './pasarela-simulada.service.js';

/** Como máximo 3 intentos por reserva (H05; CHECK de DB-05.1). */
export const MAX_INTENTOS = 3;

/**
 * Un intento PENDIENTE más viejo que esto se da por abandonado (el proceso se
 * cayó entre registrar el intento y guardar el resultado). La pasarela tarda
 * 2 s, así que 30 s deja mucho margen.
 */
export const PENDIENTE_HUERFANO_MS = 30_000;

export const MOTIVO_INTENTO_NO_COMPLETADO = 'El intento de pago no se completó';

type Decision =
  | { tipo: 'error'; error: HttpException }
  | { tipo: 'intento'; pago: SimulatedPayment; reserva: ReservaParaPago };

/**
 * Pago simulado de una reserva (H05).
 *
 * 1. Con la fila de la reserva bloqueada (transacción corta): valida la
 *    reserva y los intentos previos y registra un intento PENDIENTE.
 * 2. Sin bloqueo: la pasarela espera y decide.
 * 3. Guarda el resultado y avisa. El pago nunca cambia el estado de la reserva.
 *
 * Solo recibe los últimos 4 dígitos de la tarjeta.
 */
@Injectable()
export class PagosService {
  private readonly logger = new Logger(PagosService.name);

  constructor(
    private readonly pagos: PagoRepository,
    private readonly pasarela: PasarelaSimuladaService,
    private readonly avisos: AvisosService,
  ) {}

  async pagar(
    reservaId: string,
    arrendatarioId: string,
    ultimos4: string,
  ): Promise<PagoSimuladoResponseDto> {
    if (!this.pasarela.esTarjetaDePrueba(ultimos4)) throw tarjetaNoValida();

    const ahora = new Date();
    // Los errores se devuelven en vez de lanzarse dentro de la transacción:
    // así el cierre de un intento huérfano se guarda aunque la petición
    // termine en 409.
    const decision = await this.pagos.conReservaBloqueada(
      reservaId,
      async (ops): Promise<Decision> => {
        const reserva = await ops.buscarReserva();
        if (!reserva || reserva.tenantId !== arrendatarioId) {
          return { tipo: 'error', error: reservaNoEncontrada() };
        }

        const intentos = await ops.listarIntentos();
        if (intentos.some((i) => i.status === 'APROBADO')) {
          return { tipo: 'error', error: conflictoPago('PAGO_YA_APROBADO') };
        }
        if (reserva.status !== 'CONFIRMADA') {
          return {
            tipo: 'error',
            error: conflictoPago('RESERVA_NO_CONFIRMADA'),
          };
        }

        const huerfanos = intentos.filter((i) => esHuerfano(i, ahora));
        if (huerfanos.length > 0) {
          await ops.cerrarComoRechazados(
            huerfanos.map((i) => i.id),
            MOTIVO_INTENTO_NO_COMPLETADO,
          );
          this.logger.warn(
            `Se cerraron ${huerfanos.length} intento(s) de pago sin completar de la reserva ${reservaId}.`,
          );
        }
        if (
          intentos.some(
            (i) => i.status === 'PENDIENTE' && !esHuerfano(i, ahora),
          )
        ) {
          return { tipo: 'error', error: conflictoPago('PAGO_EN_PROCESO') };
        }
        if (intentos.length >= MAX_INTENTOS) {
          return { tipo: 'error', error: conflictoPago('INTENTOS_AGOTADOS') };
        }

        const pago = await ops.crearPendiente({
          reservationId: reserva.id,
          attemptNumber: intentos.length + 1,
          // Los importes salen de la reserva, nunca del request.
          rentalCost: reserva.rentalCost,
          depositAmount: reserva.depositAmount,
          totalAmount: reserva.rentalCost.plus(reserva.depositAmount),
          cardLast4: ultimos4,
          createdAt: ahora,
        });
        return { tipo: 'intento', pago, reserva };
      },
    );
    if (decision.tipo === 'error') throw decision.error;

    const { pago, reserva } = decision;
    const resultado = await this.pasarela.procesar(ultimos4);
    const cerrado = await this.pagos.cerrarIntento(pago.id, resultado);
    if (!cerrado) {
      // Otro proceso lo cerró mientras la pasarela respondía (solo pasa si
      // tardó más que PENDIENTE_HUERFANO_MS). Se informa lo que quedó guardado.
      this.logger.warn(`El intento de pago ${pago.id} ya estaba cerrado.`);
      return PagoSimuladoResponseDto.fromEntity(
        await this.pagos.buscarIntento(pago.id),
      );
    }

    await this.avisar(cerrado, reserva);
    return PagoSimuladoResponseDto.fromEntity(cerrado);
  }

  /**
   * Estado del último pago de una reserva propia (H06). 404 igual si la
   * reserva no existe o es de otro; 404 con `PAGO_NO_REGISTRADO` solo si es
   * suya y todavía no tiene intentos.
   */
  async ultimoPago(
    reservaId: string,
    arrendatarioId: string,
  ): Promise<UltimoPagoResponseDto> {
    const encontrado = await this.pagos.buscarUltimoPagoDeArrendatario(
      reservaId,
      arrendatarioId,
    );
    if (!encontrado) throw reservaNoEncontrada();
    if (!encontrado.pago) throw pagoNoRegistrado();
    return UltimoPagoResponseDto.fromEntity(encontrado.pago);
  }

  /**
   * Avisos de H05, con los textos del contrato del servicio de avisos. Si un
   * aviso falla, el pago ya está guardado: se registra el error y se sigue.
   */
  private async avisar(
    pago: SimulatedPayment,
    reserva: ReservaParaPago,
  ): Promise<void> {
    const monto = `$${pago.totalAmount.toFixed(2)}`;
    const bien = reserva.listing.name;
    const base = {
      moduloOrigen: ModuloOrigen.PAGOS_GARANTIA,
      referencia: { tipo: 'pago', id: pago.id },
    };

    const avisos: Aviso[] =
      pago.status === 'APROBADO'
        ? [
            {
              ...base,
              destinatarioId: reserva.tenantId,
              titulo: 'Pago aprobado',
              mensaje: `Tu pago de ${monto} por «${bien}» fue aprobado.`,
            },
            {
              ...base,
              destinatarioId: reserva.listing.landlordId,
              titulo: 'Pago confirmado',
              mensaje: `Se confirmó el pago de ${monto} de la reserva de «${bien}».`,
            },
          ]
        : [
            {
              ...base,
              destinatarioId: reserva.tenantId,
              titulo: 'Pago rechazado',
              mensaje: `Tu pago de ${monto} por «${bien}» fue rechazado. La reserva sigue confirmada y puedes intentar el pago de nuevo.`,
            },
          ];

    const resultados = await Promise.allSettled(
      avisos.map((aviso) => this.avisos.notificar(aviso)),
    );
    resultados.forEach((r, i) => {
      if (r.status === 'rejected') {
        const error = r.reason as Error;
        this.logger.error(
          `No se pudo registrar el aviso «${avisos[i].titulo}» del pago ${pago.id}: ${error?.message ?? String(r.reason)}`,
          error?.stack,
        );
      }
    });
  }
}

function esHuerfano(intento: IntentoRegistrado, ahora: Date): boolean {
  return (
    intento.status === 'PENDIENTE' &&
    ahora.getTime() - intento.createdAt.getTime() > PENDIENTE_HUERFANO_MS
  );
}
