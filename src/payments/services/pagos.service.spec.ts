import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type SimulatedPayment } from '@PrismaClient';
import { ModuloOrigen, type AvisosService } from '@Notifications';
import type {
  IntentoRegistrado,
  OperacionesConBloqueo,
  PagoRepository,
  ReservaParaPago,
} from '@Payments/repositories';
import {
  MOTIVO_INTENTO_NO_COMPLETADO,
  PENDIENTE_HUERFANO_MS,
  PagosService,
} from './pagos.service.js';
import {
  MOTIVO_RECHAZO_PASARELA,
  PasarelaSimuladaService,
} from './pasarela-simulada.service.js';

const RESERVA_ID = '11111111-1111-4111-8111-111111111111';
const ARRENDATARIO = '22222222-2222-4222-8222-222222222222';
const ARRENDADOR = '33333333-3333-4333-8333-333333333333';
const PAGO_ID = '44444444-4444-4444-8444-444444444444';

function reserva(cambios: Partial<ReservaParaPago> = {}): ReservaParaPago {
  return {
    id: RESERVA_ID,
    tenantId: ARRENDATARIO,
    status: 'CONFIRMADA',
    rentalCost: new Prisma.Decimal('40.10'),
    depositAmount: new Prisma.Decimal('9.95'),
    listing: { name: 'Taladro percutor', landlordId: ARRENDADOR },
    ...cambios,
  };
}

function intento(cambios: Partial<IntentoRegistrado> = {}): IntentoRegistrado {
  return {
    id: crypto.randomUUID(),
    status: 'RECHAZADO',
    attemptNumber: 1,
    createdAt: new Date(),
    ...cambios,
  };
}

function pagoGuardado(
  cambios: Partial<SimulatedPayment> = {},
): SimulatedPayment {
  return {
    id: PAGO_ID,
    reservationId: RESERVA_ID,
    totalAmount: new Prisma.Decimal('50.05'),
    rentalCost: new Prisma.Decimal('40.10'),
    depositAmount: new Prisma.Decimal('9.95'),
    status: 'PENDIENTE',
    cardLast4: '4242',
    rejectionReason: null,
    attemptNumber: 1,
    createdAt: new Date(),
    ...cambios,
  };
}

describe('PagosService', () => {
  let ops: { [K in keyof OperacionesConBloqueo]: ReturnType<typeof vi.fn> };
  let repo: {
    conReservaBloqueada: ReturnType<typeof vi.fn>;
    cerrarIntento: ReturnType<typeof vi.fn>;
    buscarIntento: ReturnType<typeof vi.fn>;
  };
  let notificar: ReturnType<typeof vi.fn>;
  let service: PagosService;

  function preparar(
    r: ReservaParaPago | null,
    intentos: IntentoRegistrado[] = [],
  ) {
    ops.buscarReserva.mockResolvedValue(r);
    ops.listarIntentos.mockResolvedValue(intentos);
  }

  beforeEach(() => {
    ops = {
      buscarReserva: vi.fn(),
      listarIntentos: vi.fn().mockResolvedValue([]),
      cerrarComoRechazados: vi.fn().mockResolvedValue(undefined),
      crearPendiente: vi.fn(
        (datos: Parameters<OperacionesConBloqueo['crearPendiente']>[0]) =>
          Promise.resolve(pagoGuardado({ ...datos, status: 'PENDIENTE' })),
      ),
    };
    repo = {
      conReservaBloqueada: vi.fn(
        (_id: string, fn: (o: OperacionesConBloqueo) => Promise<unknown>) =>
          fn(ops as unknown as OperacionesConBloqueo),
      ),
      cerrarIntento: vi.fn(
        (
          _id: string,
          r: { estado: 'APROBADO' } | { estado: 'RECHAZADO'; motivo: string },
        ) =>
          Promise.resolve(
            pagoGuardado({
              status: r.estado,
              rejectionReason: r.estado === 'RECHAZADO' ? r.motivo : null,
            }),
          ),
      ),
      buscarIntento: vi.fn(),
    };
    notificar = vi.fn().mockResolvedValue({ id: 'aviso' });
    service = new PagosService(
      repo as unknown as PagoRepository,
      new PasarelaSimuladaService({ retardoMs: 0 }),
      { notificar } as unknown as AvisosService,
    );
  });

  it('4242 aprueba, copia los importes de la reserva y registra el intento 1', async () => {
    preparar(reserva());
    const respuesta = await service.pagar(RESERVA_ID, ARRENDATARIO, '4242');

    expect(ops.crearPendiente).toHaveBeenCalledTimes(1);
    const datos = ops.crearPendiente.mock.calls[0][0];
    expect(datos).toMatchObject({
      reservationId: RESERVA_ID,
      attemptNumber: 1,
      cardLast4: '4242',
    });
    expect(datos.rentalCost.toFixed(2)).toBe('40.10');
    expect(datos.depositAmount.toFixed(2)).toBe('9.95');
    // Decimal, sin floats: 40.10 + 9.95 = 50.05 exacto.
    expect(datos.totalAmount.toFixed(2)).toBe('50.05');
    expect(repo.cerrarIntento).toHaveBeenCalledWith(PAGO_ID, {
      estado: 'APROBADO',
    });
    expect(respuesta).toEqual({
      pagoId: PAGO_ID,
      reservaId: RESERVA_ID,
      montoTotal: '50.05',
      estado: 'APROBADO',
      simulado: true,
      intento: 1,
    });
  });

  it('0002 rechaza con el motivo de la pasarela', async () => {
    preparar(reserva(), [intento({ attemptNumber: 1 })]);
    const respuesta = await service.pagar(RESERVA_ID, ARRENDATARIO, '0002');

    expect(ops.crearPendiente.mock.calls[0][0].attemptNumber).toBe(2);
    expect(repo.cerrarIntento).toHaveBeenCalledWith(PAGO_ID, {
      estado: 'RECHAZADO',
      motivo: MOTIVO_RECHAZO_PASARELA,
    });
    expect(respuesta).toMatchObject({
      estado: 'RECHAZADO',
      motivo: MOTIVO_RECHAZO_PASARELA,
    });
  });

  it('otra tarjeta da 400 TARJETA_NO_VALIDA sin tocar la base', async () => {
    const error = await service
      .pagar(RESERVA_ID, ARRENDATARIO, '1111')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      codigo: 'TARJETA_NO_VALIDA',
    });
    expect(repo.conReservaBloqueada).not.toHaveBeenCalled();
  });

  it.each([
    ['inexistente', null],
    ['ajena', reserva({ tenantId: '55555555-5555-4555-8555-555555555555' })],
  ])('reserva %s da 404 con el mismo mensaje', async (_caso, r) => {
    preparar(r);
    const error = await service
      .pagar(RESERVA_ID, ARRENDATARIO, '4242')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).message).toBe('La reserva no existe.');
    expect(ops.crearPendiente).not.toHaveBeenCalled();
  });

  async function esperarConflicto(codigo: string) {
    const error = await service
      .pagar(RESERVA_ID, ARRENDATARIO, '4242')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      statusCode: 409,
      error: 'Conflict',
      codigo,
    });
    expect(ops.crearPendiente).not.toHaveBeenCalled();
    expect(repo.cerrarIntento).not.toHaveBeenCalled();
  }

  it.each([
    'PENDIENTE',
    'RECHAZADA',
    'CANCELADA',
    'EN_CURSO',
    'COMPLETADA',
  ] as const)('reserva %s da 409 RESERVA_NO_CONFIRMADA', async (status) => {
    preparar(reserva({ status }));
    await esperarConflicto('RESERVA_NO_CONFIRMADA');
  });

  it('PAGO_YA_APROBADO tiene prioridad sobre RESERVA_NO_CONFIRMADA', async () => {
    preparar(reserva({ status: 'COMPLETADA' }), [
      intento({ status: 'APROBADO' }),
    ]);
    await esperarConflicto('PAGO_YA_APROBADO');
  });

  it('un PENDIENTE reciente da 409 PAGO_EN_PROCESO', async () => {
    preparar(reserva(), [
      intento({ status: 'PENDIENTE', createdAt: new Date() }),
    ]);
    await esperarConflicto('PAGO_EN_PROCESO');
  });

  it('con 3 intentos da 409 INTENTOS_AGOTADOS', async () => {
    preparar(
      reserva(),
      [1, 2, 3].map((n) => intento({ attemptNumber: n })),
    );
    await esperarConflicto('INTENTOS_AGOTADOS');
  });

  it(`cierra un PENDIENTE de más de ${PENDIENTE_HUERFANO_MS / 1000} s como RECHAZADO y sigue con el intento siguiente`, async () => {
    const viejo = intento({
      status: 'PENDIENTE',
      createdAt: new Date(Date.now() - PENDIENTE_HUERFANO_MS - 1000),
    });
    preparar(reserva(), [viejo]);
    await service.pagar(RESERVA_ID, ARRENDATARIO, '4242');

    expect(ops.cerrarComoRechazados).toHaveBeenCalledWith(
      [viejo.id],
      MOTIVO_INTENTO_NO_COMPLETADO,
    );
    expect(ops.crearPendiente.mock.calls[0][0].attemptNumber).toBe(2);
  });

  it('un PENDIENTE huérfano cuenta como intento', async () => {
    const viejo = intento({
      status: 'PENDIENTE',
      attemptNumber: 3,
      createdAt: new Date(Date.now() - PENDIENTE_HUERFANO_MS - 1000),
    });
    preparar(reserva(), [
      intento({ attemptNumber: 1 }),
      intento({ attemptNumber: 2 }),
      viejo,
    ]);
    await esperarConflicto('INTENTOS_AGOTADOS');
    expect(ops.cerrarComoRechazados).toHaveBeenCalledWith(
      [viejo.id],
      MOTIVO_INTENTO_NO_COMPLETADO,
    );
  });

  describe('avisos', () => {
    it('APROBADO avisa al arrendatario y al arrendador con los textos del contrato', async () => {
      preparar(reserva());
      await service.pagar(RESERVA_ID, ARRENDATARIO, '4242');

      expect(notificar).toHaveBeenCalledTimes(2);
      expect(notificar).toHaveBeenCalledWith({
        destinatarioId: ARRENDATARIO,
        titulo: 'Pago aprobado',
        mensaje: 'Tu pago de $50.05 por «Taladro percutor» fue aprobado.',
        moduloOrigen: ModuloOrigen.PAGOS_GARANTIA,
        referencia: { tipo: 'pago', id: PAGO_ID },
      });
      expect(notificar).toHaveBeenCalledWith({
        destinatarioId: ARRENDADOR,
        titulo: 'Pago confirmado',
        mensaje:
          'Se confirmó el pago de $50.05 de la reserva de «Taladro percutor».',
        moduloOrigen: ModuloOrigen.PAGOS_GARANTIA,
        referencia: { tipo: 'pago', id: PAGO_ID },
      });
    });

    it('RECHAZADO avisa solo al arrendatario', async () => {
      preparar(reserva());
      await service.pagar(RESERVA_ID, ARRENDATARIO, '0002');

      expect(notificar).toHaveBeenCalledTimes(1);
      expect(notificar).toHaveBeenCalledWith({
        destinatarioId: ARRENDATARIO,
        titulo: 'Pago rechazado',
        mensaje:
          'Tu pago de $50.05 por «Taladro percutor» fue rechazado. La reserva sigue confirmada y puedes intentar el pago de nuevo.',
        moduloOrigen: ModuloOrigen.PAGOS_GARANTIA,
        referencia: { tipo: 'pago', id: PAGO_ID },
      });
    });

    it('si un aviso falla, la respuesta no cambia y se registra el error', async () => {
      const log = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      notificar.mockRejectedValueOnce(new Error('base caída'));
      preparar(reserva());

      const respuesta = await service.pagar(RESERVA_ID, ARRENDATARIO, '4242');

      expect(respuesta).toMatchObject({ estado: 'APROBADO', pagoId: PAGO_ID });
      expect(notificar).toHaveBeenCalledTimes(2);
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0][0])).toContain(PAGO_ID);
      log.mockRestore();
    });
  });

  it('si el intento ya estaba cerrado, devuelve lo guardado y no avisa', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    preparar(reserva());
    repo.cerrarIntento.mockResolvedValueOnce(null);
    repo.buscarIntento.mockResolvedValueOnce(
      pagoGuardado({
        status: 'RECHAZADO',
        rejectionReason: MOTIVO_INTENTO_NO_COMPLETADO,
      }),
    );

    const respuesta = await service.pagar(RESERVA_ID, ARRENDATARIO, '4242');

    expect(respuesta).toMatchObject({
      estado: 'RECHAZADO',
      motivo: MOTIVO_INTENTO_NO_COMPLETADO,
    });
    expect(notificar).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
