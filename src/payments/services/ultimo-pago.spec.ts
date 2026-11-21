import { NotFoundException } from '@nestjs/common';
import { Prisma, type SimulatedPayment } from '@PrismaClient';
import type { AvisosService } from '@Notifications';
import type { PagoRepository } from '@Payments/repositories';
import { PagosService } from './pagos.service.js';
import type { PasarelaSimuladaService } from './pasarela-simulada.service.js';

const RESERVA_ID = '11111111-1111-4111-8111-111111111111';
const ARRENDATARIO = '22222222-2222-4222-8222-222222222222';

function pago(cambios: Partial<SimulatedPayment> = {}): SimulatedPayment {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    reservationId: RESERVA_ID,
    totalAmount: new Prisma.Decimal('65'),
    rentalCost: new Prisma.Decimal('55'),
    depositAmount: new Prisma.Decimal('10'),
    status: 'APROBADO',
    cardLast4: '4242',
    rejectionReason: null,
    attemptNumber: 1,
    createdAt: new Date('2026-11-12T16:00:00Z'),
    ...cambios,
  };
}

describe('PagosService.ultimoPago (BE-06.1)', () => {
  let buscar: ReturnType<typeof vi.fn>;
  let service: PagosService;

  beforeEach(() => {
    buscar = vi.fn();
    service = new PagosService(
      { buscarUltimoPagoDeArrendatario: buscar } as unknown as PagoRepository,
      {} as PasarelaSimuladaService,
      {} as AvisosService,
    );
  });

  it('devuelve el pago con los campos completos', async () => {
    buscar.mockResolvedValue({ pago: pago() });

    await expect(service.ultimoPago(RESERVA_ID, ARRENDATARIO)).resolves.toEqual(
      {
        pagoId: '44444444-4444-4444-8444-444444444444',
        reservaId: RESERVA_ID,
        montoTotal: '65.00',
        fechaRegistro: '2026-11-12T16:00:00.000Z',
        estado: 'APROBADO',
        simulado: true,
      },
    );
    expect(buscar).toHaveBeenCalledWith(RESERVA_ID, ARRENDATARIO);
  });

  it('incluye el motivo solo si fue rechazado', async () => {
    buscar.mockResolvedValue({
      pago: pago({ status: 'RECHAZADO', rejectionReason: 'Sin fondos' }),
    });

    const respuesta = await service.ultimoPago(RESERVA_ID, ARRENDATARIO);

    expect(respuesta).toMatchObject({
      estado: 'RECHAZADO',
      motivo: 'Sin fondos',
    });
  });

  it('reserva inexistente o ajena: 404 sin codigo', async () => {
    buscar.mockResolvedValue(null);

    const error = await service
      .ultimoPago(RESERVA_ID, ARRENDATARIO)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).message).toBe('La reserva no existe.');
    expect((error as NotFoundException).getResponse()).not.toHaveProperty(
      'codigo',
    );
  });

  it('reserva propia sin pagos: 404 con PAGO_NO_REGISTRADO', async () => {
    buscar.mockResolvedValue({ pago: null });

    const error = await service
      .ultimoPago(RESERVA_ID, ARRENDATARIO)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).getResponse()).toMatchObject({
      statusCode: 404,
      codigo: 'PAGO_NO_REGISTRADO',
    });
  });
});
