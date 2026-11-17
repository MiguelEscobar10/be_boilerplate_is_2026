import { Injectable } from '@nestjs/common';
import type {
  Prisma,
  ReservationStatus,
  SimulatedPayment,
  SimulatedPaymentStatus,
} from '@PrismaClient';
import { PrismaService } from '@Prisma/services';

/** Lo que el servicio necesita de la reserva para cobrarla. */
export interface ReservaParaPago {
  id: string;
  tenantId: string;
  status: ReservationStatus;
  rentalCost: Prisma.Decimal;
  depositAmount: Prisma.Decimal;
  listing: { name: string; landlordId: string };
}

/** Resumen de un intento ya registrado. */
export interface IntentoRegistrado {
  id: string;
  status: SimulatedPaymentStatus;
  attemptNumber: number;
  createdAt: Date;
}

export interface NuevoIntento {
  reservationId: string;
  attemptNumber: number;
  rentalCost: Prisma.Decimal;
  depositAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  cardLast4: string;
  createdAt: Date;
}

/** Operaciones disponibles mientras se tiene bloqueada la fila de la reserva. */
export interface OperacionesConBloqueo {
  buscarReserva(): Promise<ReservaParaPago | null>;
  listarIntentos(): Promise<IntentoRegistrado[]>;
  cerrarComoRechazados(ids: string[], motivo: string): Promise<void>;
  crearPendiente(datos: NuevoIntento): Promise<SimulatedPayment>;
}

export type ResultadoPasarelaParaGuardar =
  { estado: 'APROBADO' } | { estado: 'RECHAZADO'; motivo: string };

/** Único punto del módulo que habla con `simulated_payments` y `reservations`. */
@Injectable()
export class PagoRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ejecuta `fn` en una transacción que primero bloquea la fila de la reserva
   * (`SELECT ... FOR UPDATE`). Otra petición sobre la misma reserva espera
   * hasta el commit, así que nunca hay dos decidiendo el intento a la vez.
   *
   * La transacción debe ser corta: la espera de la pasarela va fuera.
   */
  conReservaBloqueada<T>(
    reservaId: string,
    fn: (ops: OperacionesConBloqueo) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM reservations WHERE id = ${reservaId}::uuid FOR UPDATE`;

      return fn({
        buscarReserva: () =>
          tx.reservation.findUnique({
            where: { id: reservaId },
            select: {
              id: true,
              tenantId: true,
              status: true,
              rentalCost: true,
              depositAmount: true,
              listing: { select: { name: true, landlordId: true } },
            },
          }),
        listarIntentos: () =>
          tx.simulatedPayment.findMany({
            where: { reservationId: reservaId },
            select: {
              id: true,
              status: true,
              attemptNumber: true,
              createdAt: true,
            },
            orderBy: { attemptNumber: 'asc' },
          }),
        cerrarComoRechazados: async (ids, motivo) => {
          await tx.simulatedPayment.updateMany({
            where: { id: { in: ids }, status: 'PENDIENTE' },
            data: { status: 'RECHAZADO', rejectionReason: motivo.trim() },
          });
        },
        crearPendiente: (datos) =>
          tx.simulatedPayment.create({
            data: { ...datos, status: 'PENDIENTE' },
          }),
      });
    });
  }

  /**
   * Guarda el resultado de la pasarela, solo si el intento sigue PENDIENTE.
   * Devuelve null si otro proceso ya lo cerró (por ejemplo, como huérfano).
   */
  async cerrarIntento(
    pagoId: string,
    resultado: ResultadoPasarelaParaGuardar,
  ): Promise<SimulatedPayment | null> {
    const { count } = await this.prisma.simulatedPayment.updateMany({
      where: { id: pagoId, status: 'PENDIENTE' },
      data:
        resultado.estado === 'APROBADO'
          ? { status: 'APROBADO', rejectionReason: null }
          : {
              status: 'RECHAZADO',
              // La base exige al menos un carácter que no sea espacio.
              rejectionReason: resultado.motivo.trim(),
            },
    });
    if (count === 0) return null;
    return this.prisma.simulatedPayment.findUniqueOrThrow({
      where: { id: pagoId },
    });
  }

  buscarIntento(pagoId: string): Promise<SimulatedPayment> {
    return this.prisma.simulatedPayment.findUniqueOrThrow({
      where: { id: pagoId },
    });
  }
}
