import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AvisosService } from '@Notifications';
import { Prisma } from '@PrismaClient';
import type { VerificationRequirementService } from '@Verification/services';
import { VerificacionRequeridaException } from '@Verification/errors';
import {
  FECHA_PASADA,
  FechaPasadaException,
  PeriodoNoDisponibleException,
} from '@Reservations/errors';
import type {
  ListingForRequest,
  ReservationDetail,
  ReservationsRepository,
} from '@Reservations/repositories';
import { ReservationsService } from './reservations.service.js';

const ARRENDATARIO = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const ARRENDADOR = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7';
const OTRA = '11111111-2222-4333-8444-555555555555';
const PUBLICACION = '7c1e0f3a-2b4d-4c6e-8f90-a1b2c3d4e5f6';
const AHORA = new Date('2026-11-10T20:00:00.000Z');
const BODY = {
  publicacionId: PUBLICACION,
  inicio: '2026-11-12T09:00:00-06:00',
  fin: '2026-11-12T12:00:00-06:00',
};

const listing = (
  cambios: Partial<ListingForRequest> = {},
): ListingForRequest => ({
  id: PUBLICACION,
  name: 'Taladro',
  landlordId: ARRENDADOR,
  isActive: true,
  rateAmount: new Prisma.Decimal('15.00'),
  rateUnit: 'HORA',
  depositAmount: new Prisma.Decimal('20.00'),
  ...cambios,
});

const guardada = (
  cambios: Partial<ReservationDetail> = {},
): ReservationDetail => ({
  id: 'res-1',
  status: 'PENDIENTE',
  tenantId: ARRENDATARIO,
  startAt: new Date('2026-11-12T15:00:00.000Z'),
  endAt: new Date('2026-11-12T18:00:00.000Z'),
  rentalCost: new Prisma.Decimal('45.00'),
  depositAmount: new Prisma.Decimal('20.00'),
  createdAt: AHORA,
  decidedAt: null,
  rejectionReason: null,
  listing: { id: PUBLICACION, name: 'Taladro', landlordId: ARRENDADOR },
  ...cambios,
});

function build() {
  const repo = {
    findListing: vi.fn().mockResolvedValue(listing()),
    hasConflict: vi.fn().mockResolvedValue(false),
    create: vi.fn().mockResolvedValue(guardada()),
    findDetail: vi.fn().mockResolvedValue(guardada()),
  };
  const requirement = {
    exigeVerificacionYNoCumple: vi.fn().mockResolvedValue(false),
  };
  const avisos = { notificar: vi.fn().mockResolvedValue({}) };
  const service = new ReservationsService(
    repo as unknown as ReservationsRepository,
    requirement as unknown as VerificationRequirementService,
    avisos as unknown as AvisosService,
  );
  return { service, repo, requirement, avisos };
}

describe('ReservationsService.create', () => {
  it('guarda la solicitud con el costo calculado por el servidor y avisa', async () => {
    const { service, repo, avisos } = build();
    const result = await service.create(ARRENDATARIO, BODY, AHORA);

    expect(repo.create).toHaveBeenCalledOnce();
    const data = repo.create.mock.calls[0][0] as {
      rentalCost: Prisma.Decimal;
      depositAmount: Prisma.Decimal;
      startAt: Date;
    };
    expect(data.rentalCost.toFixed(2)).toBe('45.00');
    expect(data.depositAmount.toFixed(2)).toBe('20.00');
    expect(data.startAt.toISOString()).toBe('2026-11-12T15:00:00.000Z');
    expect(result).toMatchObject({
      id: 'res-1',
      estado: 'PENDIENTE',
      costoAlquiler: '45.00',
      depositoMonto: '20.00',
      inicio: '2026-11-12T09:00:00-06:00',
    });
    expect(avisos.notificar).toHaveBeenCalledOnce();
    expect(avisos.notificar.mock.calls[0][0]).toMatchObject({
      destinatarioId: ARRENDADOR,
      titulo: 'Nueva solicitud de reserva',
    });
  });

  it('fin igual o anterior al inicio: 400 y no guarda', async () => {
    const { service, repo } = build();
    for (const fin of [BODY.inicio, '2026-11-12T08:00:00-06:00']) {
      await expect(
        service.create(ARRENDATARIO, { ...BODY, fin }, AHORA),
      ).rejects.toThrow(BadRequestException);
    }
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('inicio en el pasado: 400 FECHA_PASADA y no guarda', async () => {
    const { service, repo } = build();
    const error = await service
      .create(
        ARRENDATARIO,
        {
          ...BODY,
          inicio: '2026-11-09T09:00:00-06:00',
          fin: '2026-11-09T12:00:00-06:00',
        },
        AHORA,
      )
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FechaPasadaException);
    expect((error as FechaPasadaException).getResponse()).toMatchObject({
      codigo: FECHA_PASADA,
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('una fecha que no existe da 400', async () => {
    const { service } = build();
    await expect(
      service.create(
        ARRENDATARIO,
        { ...BODY, inicio: '2026-11-31T09:00:00-06:00' },
        AHORA,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('publicación inexistente o inactiva: 404', async () => {
    const { service, repo } = build();
    repo.findListing.mockResolvedValueOnce(null);
    await expect(service.create(ARRENDATARIO, BODY, AHORA)).rejects.toThrow(
      NotFoundException,
    );
    repo.findListing.mockResolvedValueOnce(listing({ isActive: false }));
    await expect(service.create(ARRENDATARIO, BODY, AHORA)).rejects.toThrow(
      NotFoundException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('exige verificación y no cumple: 422 y no guarda ni avisa', async () => {
    const { service, repo, requirement, avisos } = build();
    requirement.exigeVerificacionYNoCumple.mockResolvedValueOnce(true);
    await expect(service.create(ARRENDATARIO, BODY, AHORA)).rejects.toThrow(
      VerificacionRequeridaException,
    );
    expect(requirement.exigeVerificacionYNoCumple).toHaveBeenCalledWith(
      PUBLICACION,
      ARRENDATARIO,
    );
    expect(repo.create).not.toHaveBeenCalled();
    expect(avisos.notificar).not.toHaveBeenCalled();
  });

  it('choque con reserva o bloqueo: 409 y no guarda ni avisa', async () => {
    const { service, repo, avisos } = build();
    repo.hasConflict.mockResolvedValueOnce(true);
    await expect(service.create(ARRENDATARIO, BODY, AHORA)).rejects.toThrow(
      PeriodoNoDisponibleException,
    );
    expect(repo.hasConflict).toHaveBeenCalledWith(
      PUBLICACION,
      new Date('2026-11-12T15:00:00.000Z'),
      new Date('2026-11-12T18:00:00.000Z'),
    );
    expect(repo.create).not.toHaveBeenCalled();
    expect(avisos.notificar).not.toHaveBeenCalled();
  });

  it('un costo que no cabe en la columna da 400', async () => {
    const { service, repo } = build();
    repo.findListing.mockResolvedValueOnce(
      listing({ rateAmount: new Prisma.Decimal('9999999999.99') }),
    );
    await expect(
      service.create(
        ARRENDATARIO,
        { ...BODY, fin: '2026-11-13T09:00:00-06:00' },
        AHORA,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('si el aviso falla la solicitud igual queda guardada', async () => {
    const { service, avisos } = build();
    avisos.notificar.mockRejectedValueOnce(new Error('caído'));
    await expect(
      service.create(ARRENDATARIO, BODY, AHORA),
    ).resolves.toMatchObject({ estado: 'PENDIENTE' });
  });
});

describe('ReservationsService.findOne', () => {
  it('el arrendatario que la pidió la ve', async () => {
    const { service } = build();
    await expect(service.findOne('res-1', ARRENDATARIO)).resolves.toMatchObject(
      {
        id: 'res-1',
        costoAlquiler: '45.00',
        depositoMonto: '20.00',
      },
    );
  });

  it('el dueño de la publicación la ve', async () => {
    const { service } = build();
    await expect(service.findOne('res-1', ARRENDADOR)).resolves.toMatchObject({
      id: 'res-1',
    });
  });

  it('otra persona recibe 404, igual que si no existiera', async () => {
    const { service, repo } = build();
    await expect(service.findOne('res-1', OTRA)).rejects.toThrow(
      NotFoundException,
    );
    repo.findDetail.mockResolvedValueOnce(null);
    await expect(service.findOne('res-2', ARRENDATARIO)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('muestra el motivo de rechazo al arrendatario (H04, criterio 8)', async () => {
    const { service, repo } = build();
    repo.findDetail.mockResolvedValueOnce(
      guardada({
        status: 'RECHAZADA',
        decidedAt: AHORA,
        rejectionReason: 'No disponible',
      }),
    );
    await expect(service.findOne('res-1', ARRENDATARIO)).resolves.toMatchObject(
      {
        estado: 'RECHAZADA',
        motivoRechazo: 'No disponible',
      },
    );
  });
});
