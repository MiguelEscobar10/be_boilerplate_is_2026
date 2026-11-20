import { NotFoundException } from '@nestjs/common';
import type { TenantRating } from '@PrismaClient';
import {
  RatingAlreadyExistsError,
  RESERVA_NO_COMPLETADA,
  RESERVA_YA_CALIFICADA,
  ReservaNoCompletadaException,
  ReservaYaCalificadaException,
} from '@TenantRatings/errors';
import type {
  ReservationToRate,
  TenantRatingRepository,
} from '@TenantRatings/repositories';
import { TenantRatingsService } from '@TenantRatings/services';

const RESERVA = '0b9d8c7e-6f5a-4b3c-9d2e-1f0a9b8c7d6e';
const ARRENDADOR = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7';
const OTRO = '11111111-2222-4333-8444-555555555555';
const ARRENDATARIO = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const CALIFICACION = 'c0ffee00-1111-4222-8333-444455556666';

function reserva(cambios: Partial<ReservationToRate> = {}): ReservationToRate {
  return {
    id: RESERVA,
    status: 'COMPLETADA',
    tenantId: ARRENDATARIO,
    landlordId: ARRENDADOR,
    ...cambios,
  };
}

describe('TenantRatingsService', () => {
  let repo: {
    findReservation: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  let service: TenantRatingsService;

  const calificar = (
    dto: { puntaje: number; comentario?: string } = { puntaje: 5 },
    landlordId = ARRENDADOR,
  ) => service.rate(RESERVA, landlordId, dto);

  beforeEach(() => {
    repo = {
      findReservation: vi.fn().mockResolvedValue(reserva()),
      create: vi.fn().mockResolvedValue({ id: CALIFICACION } as TenantRating),
    };
    service = new TenantRatingsService(
      repo as unknown as TenantRatingRepository,
    );
  });

  it('guarda la calificación con el arrendatario de la reserva y devuelve su id', async () => {
    const result = await calificar({
      puntaje: 4,
      comentario: 'Devolvió el equipo a tiempo',
    });

    expect(repo.create).toHaveBeenCalledWith({
      reservationId: RESERVA,
      authorId: ARRENDADOR,
      tenantId: ARRENDATARIO,
      score: 4,
      comment: 'Devolvió el equipo a tiempo',
    });
    expect(result).toEqual({ id: CALIFICACION });
  });

  it.each([
    ['sin comentario', undefined],
    ['comentario vacío (ya recortado por el DTO)', ''],
  ])('%s se guarda como null', async (_caso, comentario) => {
    await calificar({ puntaje: 3, comentario });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ comment: null }),
    );
  });

  it('404 si la reserva no existe', async () => {
    repo.findReservation.mockResolvedValue(null);

    await expect(calificar()).rejects.toThrow(NotFoundException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('404 si la reserva es de un bien de otro arrendador, con el mismo texto', async () => {
    const ajena = await calificar({ puntaje: 5 }, OTRO).catch(
      (e: unknown) => e,
    );
    repo.findReservation.mockResolvedValue(null);
    const inexistente = await calificar().catch((e: unknown) => e);

    expect(ajena).toBeInstanceOf(NotFoundException);
    expect((ajena as Error).message).toBe((inexistente as Error).message);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('el dueño se revisa antes que el estado: una ajena sin terminar es 404, no 422', async () => {
    repo.findReservation.mockResolvedValue(reserva({ status: 'EN_CURSO' }));

    await expect(calificar({ puntaje: 5 }, OTRO)).rejects.toThrow(
      NotFoundException,
    );
  });

  it.each([
    'PENDIENTE',
    'CONFIRMADA',
    'RECHAZADA',
    'CANCELADA',
    'EN_CURSO',
  ] as const)('422 RESERVA_NO_COMPLETADA si está %s', async (status) => {
    repo.findReservation.mockResolvedValue(reserva({ status }));

    const error = await calificar().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ReservaNoCompletadaException);
    expect((error as ReservaNoCompletadaException).getStatus()).toBe(422);
    expect((error as ReservaNoCompletadaException).getResponse()).toMatchObject(
      { codigo: RESERVA_NO_COMPLETADA },
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('409 "Esta reserva ya fue calificada." si el índice único la rechaza', async () => {
    repo.create.mockRejectedValue(new RatingAlreadyExistsError());

    const error = await calificar().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ReservaYaCalificadaException);
    expect((error as ReservaYaCalificadaException).getResponse()).toEqual({
      statusCode: 409,
      error: 'Conflict',
      codigo: RESERVA_YA_CALIFICADA,
      message: 'Esta reserva ya fue calificada.',
    });
  });

  it('un error que no es de dominio se propaga tal cual', async () => {
    const caida = new Error('base caída');
    repo.create.mockRejectedValue(caida);

    await expect(calificar()).rejects.toBe(caida);
  });
});
