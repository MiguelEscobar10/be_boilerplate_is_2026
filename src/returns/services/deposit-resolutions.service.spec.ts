import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AvisosService } from '@Notifications';
import { Prisma } from '@PrismaClient';
import {
  DepositConflictError,
  GarantiaNoResolubleException,
} from '@Returns/errors';
import type {
  DepositResolutionRepository,
  DepositState,
  ResolveDepositData,
} from '@Returns/repositories';
import { DepositResolutionsService } from '@Returns/services';

const RESERVA = '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const DUENO = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7';
const INQUILINO = '0b9d8c7e-6f5a-4b3c-9d2e-1f0a9b8c7d6e';

function estado(cambios: Partial<DepositState> = {}): DepositState {
  return {
    id: RESERVA,
    status: 'EN_CURSO',
    tenantId: INQUILINO,
    landlordId: DUENO,
    listingName: 'Proyector',
    depositAmount: new Prisma.Decimal('20.00'),
    returnFinalState: 'CON_OBSERVACIONES',
    resolution: null,
    ...cambios,
  };
}

describe('DepositResolutionsService', () => {
  let repo: {
    findState: ReturnType<typeof vi.fn>;
    resolveAndComplete: ReturnType<typeof vi.fn>;
  };
  let avisos: { notificar: ReturnType<typeof vi.fn> };
  let service: DepositResolutionsService;

  beforeEach(() => {
    repo = {
      findState: vi.fn().mockResolvedValue(estado()),
      resolveAndComplete: vi
        .fn()
        .mockImplementation((data: ResolveDepositData) =>
          Promise.resolve({
            id: 'g-1',
            ...data,
            status: data.retainedAmount.isZero() ? 'LIBERADA' : 'RETENIDA',
            resolvedAt: new Date(),
          }),
        ),
    };
    avisos = { notificar: vi.fn().mockResolvedValue({ id: 'a-1' }) };
    service = new DepositResolutionsService(
      repo as unknown as DepositResolutionRepository,
      avisos as unknown as AvisosService,
    );
  });

  const resolver = (montoRetenido: number, motivo?: string) =>
    service.resolve(RESERVA, DUENO, { montoRetenido, motivo });

  const guardado = () =>
    repo.resolveAndComplete.mock.calls[0][0] as ResolveDepositData;

  describe('resolve', () => {
    it('retiene una parte: liberado = depósito - retenido, RETENIDA y COMPLETADA', async () => {
      const resultado = await resolver(5, '  Daño reportado  ');

      expect(guardado().originalDeposit.toFixed(2)).toBe('20.00');
      expect(guardado().retainedAmount.toFixed(2)).toBe('5.00');
      expect(guardado().releasedAmount.toFixed(2)).toBe('15.00');
      expect(guardado().reason).toBe('Daño reportado');
      expect(resultado.status).toBe('COMPLETADA');
      expect(resultado.resolution?.status).toBe('RETENIDA');
    });

    it.each([
      [0.1, '20.00', '19.90'],
      [0.07, '0.21', '0.14'],
      [19.99, '20.00', '0.01'],
      [1000.1, '3000.30', '2000.20'],
    ])(
      'calcula a dos decimales exactos: retener %s de %s libera %s',
      async (retenido, deposito, liberado) => {
        repo.findState.mockResolvedValue(
          estado({ depositAmount: new Prisma.Decimal(deposito) }),
        );

        await resolver(retenido, 'Daño');

        expect(guardado().releasedAmount.toFixed(2)).toBe(liberado);
      },
    );

    it('con retenido 0 libera la garantía completa, sin motivo', async () => {
      const resultado = await resolver(0);

      expect(guardado().releasedAmount.toFixed(2)).toBe('20.00');
      expect(guardado().reason).toBeNull();
      expect(resultado.resolution?.status).toBe('LIBERADA');
    });

    it('acepta retener el depósito completo', async () => {
      await resolver(20, 'Equipo destruido');
      expect(guardado().releasedAmount.toFixed(2)).toBe('0.00');
    });

    it('una devolución SIN_OBSERVACIONES admite retenido 0 (LIBERADA)', async () => {
      repo.findState.mockResolvedValue(
        estado({ returnFinalState: 'SIN_OBSERVACIONES' }),
      );
      const resultado = await resolver(0);
      expect(resultado.resolution?.status).toBe('LIBERADA');
    });

    it('sin garantía permite el cierre con ambos importes en 0', async () => {
      repo.findState.mockResolvedValue(
        estado({ depositAmount: new Prisma.Decimal(0) }),
      );

      const resultado = await resolver(0);

      expect(guardado().retainedAmount.toFixed(2)).toBe('0.00');
      expect(guardado().releasedAmount.toFixed(2)).toBe('0.00');
      expect(resultado.status).toBe('COMPLETADA');
    });

    it.each([
      ['un importe negativo', -0.01, 'Daño'],
      ['una retención sin motivo', 5, undefined],
      ['una retención con motivo de solo espacios', 5, '   '],
      ['un motivo de 501 caracteres', 5, 'a'.repeat(501)],
    ])(
      'responde 400 con %s, sin consultar ni guardar',
      async (_, monto, motivo) => {
        await expect(resolver(monto, motivo)).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(repo.findState).not.toHaveBeenCalled();
        expect(repo.resolveAndComplete).not.toHaveBeenCalled();
      },
    );

    it('responde 404 si la reserva no existe', async () => {
      repo.findState.mockResolvedValue(null);
      await expect(resolver(0)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('responde 403 si la reserva no es de un bien del arrendador', async () => {
      repo.findState.mockResolvedValue(estado({ landlordId: 'otro' }));
      await expect(resolver(0)).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.resolveAndComplete).not.toHaveBeenCalled();
    });

    it.each([
      [
        'ya tiene resolución',
        { resolution: { id: 'g-0' } as DepositState['resolution'] },
      ],
      ['ya está COMPLETADA', { status: 'COMPLETADA' as const }],
    ])('responde 409 si la reserva %s', async (_, cambios) => {
      repo.findState.mockResolvedValue(estado(cambios));
      await expect(resolver(0)).rejects.toBeInstanceOf(ConflictException);
      expect(repo.resolveAndComplete).not.toHaveBeenCalled();
    });

    it.each([
      [
        'sin devolución',
        { returnFinalState: null },
        0,
        'DEVOLUCION_NO_REGISTRADA',
        'Primero registra la devolución',
      ],
      [
        'con una retención superior al depósito',
        {},
        20.01,
        'RETENCION_SUPERA_DEPOSITO',
        'El monto retenido no puede superar el depósito',
      ],
      [
        'con retención y una devolución SIN_OBSERVACIONES',
        { returnFinalState: 'SIN_OBSERVACIONES' as const },
        5,
        'RETENCION_SIN_OBSERVACIONES',
        'No se puede retener la garantía de una devolución sin observaciones',
      ],
    ])(
      'responde 422 %s, sin guardar ni avisar',
      async (_, cambios, monto, codigo, message) => {
        repo.findState.mockResolvedValue(estado(cambios));

        const error = await resolver(monto, 'Daño').catch((e: unknown) => e);

        expect(error).toBeInstanceOf(GarantiaNoResolubleException);
        expect(
          (error as GarantiaNoResolubleException).getResponse(),
        ).toMatchObject({ statusCode: 422, codigo, message });
        expect(repo.resolveAndComplete).not.toHaveBeenCalled();
        expect(avisos.notificar).not.toHaveBeenCalled();
      },
    );

    it.each(['YA_RESUELTA', 'NO_EN_CURSO'] as const)(
      'traduce a 409 el conflicto %s de la transacción y no avisa',
      async (reason) => {
        repo.resolveAndComplete.mockRejectedValue(
          new DepositConflictError(reason),
        );
        await expect(resolver(0)).rejects.toBeInstanceOf(ConflictException);
        expect(avisos.notificar).not.toHaveBeenCalled();
      },
    );

    it('avisa al arrendatario con el bien, el monto liberado y el retenido', async () => {
      await resolver(5, 'Daño reportado');

      expect(avisos.notificar).toHaveBeenCalledTimes(1);
      expect(avisos.notificar).toHaveBeenCalledWith({
        destinatarioId: INQUILINO,
        titulo: 'Depósito de garantía resuelto',
        mensaje:
          'El depósito de garantía de «Proyector» fue resuelto: monto liberado $15.00, monto retenido $5.00.',
        moduloOrigen: 'PAGOS_GARANTIA',
        referencia: { tipo: 'reserva', id: RESERVA },
      });
    });

    it('si el aviso falla, la resolución ya guardada se devuelve igual', async () => {
      avisos.notificar.mockRejectedValue(new Error('sin bandeja'));

      const resultado = await resolver(0);

      expect(resultado.status).toBe('COMPLETADA');
    });
  });

  describe('findForParticipant', () => {
    it.each([
      ['el arrendador', DUENO],
      ['el arrendatario', INQUILINO],
    ])('devuelve el estado de la garantía a %s', async (_, userId) => {
      const resultado = await service.findForParticipant(RESERVA, userId);
      expect(resultado.id).toBe(RESERVA);
    });

    it('responde 404 a quien no participa y si la reserva no existe', async () => {
      await expect(
        service.findForParticipant(RESERVA, 'otro'),
      ).rejects.toBeInstanceOf(NotFoundException);

      repo.findState.mockResolvedValue(null);
      await expect(
        service.findForParticipant(RESERVA, DUENO),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
