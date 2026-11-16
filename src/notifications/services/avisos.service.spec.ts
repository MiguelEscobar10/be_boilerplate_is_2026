import { AvisosService } from '@Notifications/services';
import type { NotificationRepository } from '@Notifications/repositories';
import {
  AvisoDuplicadoError,
  AvisoInvalidoError,
  DestinatarioInexistenteError,
} from '@Notifications/errors';
import {
  ModuloOrigen,
  type Aviso,
  type CampoAviso,
} from '@Notifications/types';

const DESTINATARIO = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7';

function avisoValido(cambios: Partial<Aviso> = {}): Aviso {
  return {
    destinatarioId: DESTINATARIO,
    titulo: 'Nueva solicitud de reserva',
    mensaje: 'Recibiste una solicitud de reserva para Cámara Sony A7.',
    moduloOrigen: ModuloOrigen.RESERVAS,
    referencia: { tipo: 'reserva', id: 'r-1' },
    ...cambios,
  };
}

describe('AvisosService.notificar', () => {
  let repo: {
    create: ReturnType<typeof vi.fn>;
    findByDedupeKey: ReturnType<typeof vi.fn>;
  };
  let service: AvisosService;

  beforeEach(() => {
    repo = {
      create: vi.fn().mockResolvedValue({ id: 'aviso-1' }),
      findByDedupeKey: vi.fn(),
    };
    service = new AvisosService(repo as unknown as NotificationRepository);
  });

  /** Espera AvisoInvalidoError en `campo` y que no se haya llamado a la base. */
  async function esperarInvalido(
    aviso: unknown,
    campo: CampoAviso,
  ): Promise<void> {
    const error = await service
      .notificar(aviso as Aviso)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AvisoInvalidoError);
    expect(error).toMatchObject({ codigo: 'AVISO_INVALIDO', campo });
    expect(repo.create).not.toHaveBeenCalled();
  }

  describe('aviso válido', () => {
    it('lo registra con la referencia y devuelve { id }', async () => {
      await expect(service.notificar(avisoValido())).resolves.toEqual({
        id: 'aviso-1',
      });
      expect(repo.create).toHaveBeenCalledWith({
        userId: DESTINATARIO,
        sourceModule: 'RESERVAS',
        title: 'Nueva solicitud de reserva',
        message: 'Recibiste una solicitud de reserva para Cámara Sony A7.',
        referenceType: 'reserva',
        referenceId: 'r-1',
      });
    });

    it.each([undefined, null])(
      'lo registra sin referencia (%s)',
      async (referencia) => {
        await service.notificar(avisoValido({ referencia }));
        expect(repo.create).toHaveBeenCalledWith(
          expect.objectContaining({ referenceType: null, referenceId: null }),
        );
      },
    );

    it('guarda título, mensaje y referencia recortados', async () => {
      await service.notificar(
        avisoValido({
          titulo: '  Pago aprobado  ',
          mensaje: '\n Tu pago de $25.00 fue aprobado. ',
          referencia: { tipo: ' pago ', id: ' p-1 ' },
        }),
      );
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Pago aprobado',
          message: 'Tu pago de $25.00 fue aprobado.',
          referenceType: 'pago',
          referenceId: 'p-1',
        }),
      );
    });

    it('acepta título de 100 y mensaje de 500 caracteres', async () => {
      await service.notificar(
        avisoValido({ titulo: 't'.repeat(100), mensaje: 'm'.repeat(500) }),
      );
      expect(repo.create).toHaveBeenCalledOnce();
    });

    it('mide el máximo después de recortar', async () => {
      await service.notificar(avisoValido({ titulo: `a${' '.repeat(200)}` }));
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'a' }),
      );
    });

    it('cuenta caracteres, no unidades UTF-16 (100 emojis caben)', async () => {
      await service.notificar(avisoValido({ titulo: '\u{1F514}'.repeat(100) }));
      expect(repo.create).toHaveBeenCalledOnce();
    });
  });

  describe('destinatario', () => {
    it.each([undefined, null, '', '   ', 42])(
      'rechaza destinatario %j',
      async (destinatarioId) => {
        await esperarInvalido(
          avisoValido({ destinatarioId: destinatarioId as string }),
          'destinatarioId',
        );
      },
    );

    it('rechaza un destinatario que no es UUID', async () => {
      await esperarInvalido(
        avisoValido({ destinatarioId: 'abc' }),
        'destinatarioId',
      );
    });

    it('traduce un destinatario inexistente a AVISO_INVALIDO', async () => {
      repo.create.mockRejectedValue(new DestinatarioInexistenteError());
      const error = await service
        .notificar(avisoValido())
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AvisoInvalidoError);
      expect(error).toMatchObject({
        codigo: 'AVISO_INVALIDO',
        campo: 'destinatarioId',
      });
    });

    it('rechaza un aviso que no es objeto', async () => {
      await esperarInvalido(undefined, 'destinatarioId');
    });
  });

  describe('título y mensaje', () => {
    it.each([undefined, null, '', '   ', '\t\n', 7])(
      'rechaza título %j',
      async (titulo) => {
        await esperarInvalido(
          avisoValido({ titulo: titulo as string }),
          'titulo',
        );
      },
    );

    it('rechaza título de 101 caracteres', async () => {
      await esperarInvalido(avisoValido({ titulo: 't'.repeat(101) }), 'titulo');
    });

    it.each([undefined, '', '   '])('rechaza mensaje %j', async (mensaje) => {
      await esperarInvalido(
        avisoValido({ mensaje: mensaje as string }),
        'mensaje',
      );
    });

    it('rechaza mensaje de 501 caracteres', async () => {
      await esperarInvalido(
        avisoValido({ mensaje: 'm'.repeat(501) }),
        'mensaje',
      );
    });
  });

  describe('módulo de origen', () => {
    it.each([undefined, '', 'INVENTADO', 'reservas', 3])(
      'rechaza %j',
      async (moduloOrigen) => {
        await esperarInvalido(
          avisoValido({ moduloOrigen: moduloOrigen as ModuloOrigen }),
          'moduloOrigen',
        );
      },
    );

    it.each(Object.values(ModuloOrigen))('acepta %s', async (moduloOrigen) => {
      await service.notificar(avisoValido({ moduloOrigen }));
      expect(repo.create).toHaveBeenCalledOnce();
    });
  });

  describe('referencia', () => {
    it('rechaza una referencia que no es objeto', async () => {
      await esperarInvalido(
        avisoValido({ referencia: 'r-1' as never }),
        'referencia',
      );
    });

    it.each([{ id: 'r-1' }, { tipo: '  ', id: 'r-1' }])(
      'rechaza referencia sin tipo %j',
      async (referencia) => {
        await esperarInvalido(
          avisoValido({ referencia: referencia as never }),
          'referencia.tipo',
        );
      },
    );

    it.each([{ tipo: 'reserva' }, { tipo: 'reserva', id: '' }])(
      'rechaza referencia sin id %j',
      async (referencia) => {
        await esperarInvalido(
          avisoValido({ referencia: referencia as never }),
          'referencia.id',
        );
      },
    );
  });

  it('reporta el primer campo con error en el orden del contrato', async () => {
    await esperarInvalido({ moduloOrigen: 'X' }, 'destinatarioId');
    await esperarInvalido(
      { destinatarioId: DESTINATARIO, moduloOrigen: 'X' },
      'titulo',
    );
  });

  describe('duplicados', () => {
    it('devuelve el id del aviso existente sin crear otro', async () => {
      repo.create.mockRejectedValue(new AvisoDuplicadoError());
      repo.findByDedupeKey.mockResolvedValue({ id: 'existente' });

      await expect(
        service.notificar(
          avisoValido({ titulo: ' Nueva solicitud de reserva ' }),
        ),
      ).resolves.toEqual({ id: 'existente' });
      expect(repo.findByDedupeKey).toHaveBeenCalledWith({
        userId: DESTINATARIO,
        sourceModule: 'RESERVAS',
        referenceType: 'reserva',
        referenceId: 'r-1',
        title: 'Nueva solicitud de reserva',
      });
    });

    it('relanza el error si no encuentra el existente', async () => {
      const duplicado = new AvisoDuplicadoError();
      repo.create.mockRejectedValue(duplicado);
      repo.findByDedupeKey.mockResolvedValue(null);
      await expect(service.notificar(avisoValido())).rejects.toBe(duplicado);
    });

    it('propaga cualquier otro error del repositorio', async () => {
      const otro = new Error('conexión caída');
      repo.create.mockRejectedValue(otro);
      await expect(service.notificar(avisoValido())).rejects.toBe(otro);
      expect(repo.findByDedupeKey).not.toHaveBeenCalled();
    });
  });
});
