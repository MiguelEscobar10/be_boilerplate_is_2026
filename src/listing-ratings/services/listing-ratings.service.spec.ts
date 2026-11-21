import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ListingLandlordRating } from '@PrismaClient';
import {
  ListingRatingAlreadyExistsError,
  ReservaNoCompletadaException,
  ReservaYaCalificadaException,
} from '@ListingRatings/errors';
import type {
  ListingRatingRepository,
  ReservationToRate,
} from '@ListingRatings/repositories';
import { ListingRatingsService } from './listing-ratings.service.js';

const RESERVA = '11111111-1111-4111-8111-111111111111';
const ARRENDATARIO = '22222222-2222-4222-8222-222222222222';
const ARRENDADOR = '33333333-3333-4333-8333-333333333333';
const PUBLICACION = '44444444-4444-4444-8444-444444444444';

function reserva(cambios: Partial<ReservationToRate> = {}): ReservationToRate {
  return {
    id: RESERVA,
    status: 'COMPLETADA',
    tenantId: ARRENDATARIO,
    listingId: PUBLICACION,
    landlordId: ARRENDADOR,
    ...cambios,
  };
}

describe('ListingRatingsService', () => {
  let repo: {
    findReservation: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    averages: ReturnType<typeof vi.fn>;
    findByReservation: ReturnType<typeof vi.fn>;
  };
  let service: ListingRatingsService;

  beforeEach(() => {
    repo = {
      findReservation: vi.fn().mockResolvedValue(reserva()),
      create: vi.fn().mockResolvedValue({ id: 'abc' } as ListingLandlordRating),
      averages: vi.fn(),
      findByReservation: vi.fn(),
    };
    service = new ListingRatingsService(
      repo as unknown as ListingRatingRepository,
    );
  });

  describe('rate', () => {
    it('guarda la calificación con los datos de la reserva y devuelve el id', async () => {
      const result = await service.rate(RESERVA, ARRENDATARIO, {
        puntajeBien: 4,
        puntajeArrendador: 5,
        comentario: 'Todo en orden',
      });

      expect(result).toEqual({ id: 'abc' });
      expect(repo.create).toHaveBeenCalledWith({
        reservationId: RESERVA,
        authorId: ARRENDATARIO,
        listingId: PUBLICACION,
        landlordId: ARRENDADOR,
        listingScore: 4,
        landlordScore: 5,
        comment: 'Todo en orden',
      });
    });

    it('sin comentario o con comentario vacío guarda null', async () => {
      await service.rate(RESERVA, ARRENDATARIO, {
        puntajeBien: 1,
        puntajeArrendador: 1,
      });
      await service.rate(RESERVA, ARRENDATARIO, {
        puntajeBien: 1,
        puntajeArrendador: 1,
        comentario: '',
      });

      expect(repo.create.mock.calls.map((c) => c[0].comment)).toEqual([
        null,
        null,
      ]);
    });

    it('reserva inexistente: 404 sin guardar', async () => {
      repo.findReservation.mockResolvedValue(null);

      await expect(
        service.rate(RESERVA, ARRENDATARIO, {
          puntajeBien: 4,
          puntajeArrendador: 4,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('reserva de otro arrendatario: el mismo 404', async () => {
      repo.findReservation.mockResolvedValue(reserva({ tenantId: 'otro' }));

      const error = await service
        .rate(RESERVA, ARRENDATARIO, { puntajeBien: 4, puntajeArrendador: 4 })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).message).toBe(
        'La reserva no existe.',
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it.each([
      'PENDIENTE',
      'CONFIRMADA',
      'RECHAZADA',
      'CANCELADA',
      'EN_CURSO',
    ] as const)('reserva %s: 422', async (status) => {
      repo.findReservation.mockResolvedValue(reserva({ status }));

      await expect(
        service.rate(RESERVA, ARRENDATARIO, {
          puntajeBien: 4,
          puntajeArrendador: 4,
        }),
      ).rejects.toBeInstanceOf(ReservaNoCompletadaException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('reserva ya calificada: 409 con codigo', async () => {
      repo.create.mockRejectedValue(new ListingRatingAlreadyExistsError());

      const error = await service
        .rate(RESERVA, ARRENDATARIO, { puntajeBien: 4, puntajeArrendador: 4 })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ReservaYaCalificadaException);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        codigo: 'RESERVA_YA_CALIFICADA',
      });
    });

    it('otro error del repositorio se propaga', async () => {
      repo.create.mockRejectedValue(new Error('boom'));

      await expect(
        service.rate(RESERVA, ARRENDATARIO, {
          puntajeBien: 4,
          puntajeArrendador: 4,
        }),
      ).rejects.toThrow('boom');
    });
  });

  describe('promedioCalificaciones', () => {
    it('devuelve los promedios del repositorio', async () => {
      repo.averages.mockResolvedValue({
        listingAverage: 4.3,
        landlordAverage: 4.7,
      });

      await expect(
        service.promedioCalificaciones(PUBLICACION),
      ).resolves.toEqual({ promedioBien: 4.3, promedioArrendador: 4.7 });
    });

    it('sin calificaciones o sin publicación devuelve null', async () => {
      repo.averages.mockResolvedValueOnce({
        listingAverage: null,
        landlordAverage: null,
      });
      repo.averages.mockResolvedValueOnce(null);

      const vacio = { promedioBien: null, promedioArrendador: null };
      await expect(
        service.promedioCalificaciones(PUBLICACION),
      ).resolves.toEqual(vacio);
      await expect(
        service.promedioCalificaciones(PUBLICACION),
      ).resolves.toEqual(vacio);
    });
  });

  describe('findRating', () => {
    it('devuelve la calificación propia', async () => {
      repo.findByReservation.mockResolvedValue({
        id: 'abc',
        reservationId: RESERVA,
        listingScore: 4,
        landlordScore: 5,
        comment: 'Todo en orden',
        createdAt: new Date('2026-11-12T16:00:00Z'),
      });

      await expect(service.findRating(RESERVA, ARRENDATARIO)).resolves.toEqual({
        id: 'abc',
        reservaId: RESERVA,
        puntajeBien: 4,
        puntajeArrendador: 5,
        comentario: 'Todo en orden',
        fechaRegistro: '2026-11-12T16:00:00.000Z',
      });
    });

    it('reserva inexistente o ajena: 404 sin codigo y sin consultar la calificación', async () => {
      repo.findReservation.mockResolvedValueOnce(null);
      repo.findReservation.mockResolvedValueOnce(reserva({ tenantId: 'otro' }));

      for (let i = 0; i < 2; i++) {
        const error = await service
          .findRating(RESERVA, ARRENDATARIO)
          .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).getResponse()).not.toHaveProperty(
          'codigo',
        );
      }
      expect(repo.findByReservation).not.toHaveBeenCalled();
    });

    it('reserva propia sin calificar: 404 con CALIFICACION_NO_REGISTRADA', async () => {
      repo.findByReservation.mockResolvedValue(null);

      const error = await service
        .findRating(RESERVA, ARRENDATARIO)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        codigo: 'CALIFICACION_NO_REGISTRADA',
      });
    });
  });
});
