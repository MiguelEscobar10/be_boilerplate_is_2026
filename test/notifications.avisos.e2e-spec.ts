import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaModule } from '@Prisma';
import { PrismaService } from '@Prisma/services';
import { NotificationsModule } from '@Notifications';
import { AvisosService } from '@Notifications/services';
import { AvisoInvalidoError } from '@Notifications/errors';
import {
  ModuloOrigen,
  type Aviso,
  type CampoAviso,
} from '@Notifications/types';
import { createTestPrismaClient } from './helpers/test-database.js';

/**
 * Servicio de avisos contra la base de pruebas (BE-20.1).
 *
 * Usa el AvisosService real, con PrismaService reemplazado por un cliente que
 * apunta a la base `_test` (ver test/helpers/test-database.ts). Crea un
 * usuario propio con email único y en afterAll borra solo ese usuario (la
 * cascada se lleva sus avisos).
 */
const prisma = createTestPrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe('servicio de avisos: notificar (BE-20.1)', () => {
  const email = `be-20.1-${randomUUID()}@test.local`;
  let userId: string;
  let avisos: AvisosService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, NotificationsModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    avisos = moduleRef.get(AvisosService);

    const user = await prisma.user.create({
      data: { email, passwordHash: 'no-es-un-hash-real' },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
  });

  function aviso(cambios: Partial<Aviso> = {}): Aviso {
    return {
      destinatarioId: userId,
      titulo: 'Nueva solicitud de reserva',
      mensaje: 'Recibiste una solicitud de reserva para Cámara Sony A7.',
      moduloOrigen: ModuloOrigen.RESERVAS,
      referencia: { tipo: 'reserva', id: randomUUID() },
      ...cambios,
    };
  }

  function contarAvisos(destinatarioId = userId): Promise<number> {
    return prisma.notification.count({ where: { userId: destinatarioId } });
  }

  /** Espera AVISO_INVALIDO en `campo` y que no se haya registrado nada. */
  async function esperarInvalido(
    entrada: unknown,
    campo: CampoAviso,
    destinatarioId = userId,
  ): Promise<void> {
    const antes = await contarAvisos(destinatarioId);
    const error = await avisos
      .notificar(entrada as Aviso)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AvisoInvalidoError);
    expect(error).toMatchObject({ codigo: 'AVISO_INVALIDO', campo });
    expect(await contarAvisos(destinatarioId)).toBe(antes);
  }

  it('registra un aviso válido como no leído', async () => {
    const entrada = aviso({ titulo: '  Pago aprobado  ' });
    const { id } = await avisos.notificar(entrada);

    const guardado = await prisma.notification.findUniqueOrThrow({
      where: { id },
    });
    expect(guardado).toMatchObject({
      userId,
      sourceModule: 'RESERVAS',
      title: 'Pago aprobado',
      message: entrada.mensaje,
      referenceType: 'reserva',
      referenceId: entrada.referencia!.id,
      readAt: null,
    });
  });

  it('registra un aviso sin referencia', async () => {
    const { id } = await avisos.notificar(
      aviso({ titulo: 'Mensaje nuevo', referencia: undefined }),
    );
    const guardado = await prisma.notification.findUniqueOrThrow({
      where: { id },
    });
    expect(guardado.referenceType).toBeNull();
    expect(guardado.referenceId).toBeNull();
  });

  it('no registra un aviso sin destinatario', async () => {
    await esperarInvalido(
      aviso({ destinatarioId: undefined as never }),
      'destinatarioId',
    );
  });

  it('no registra un aviso sin título', async () => {
    await esperarInvalido(aviso({ titulo: undefined as never }), 'titulo');
    await esperarInvalido(aviso({ titulo: '   ' }), 'titulo');
  });

  it('no registra un aviso con módulo de origen inválido', async () => {
    await esperarInvalido(
      aviso({ moduloOrigen: 'INVENTADO' as ModuloOrigen }),
      'moduloOrigen',
    );
  });

  it('no registra un aviso para un destinatario inexistente', async () => {
    const inexistente = randomUUID();
    await esperarInvalido(
      aviso({ destinatarioId: inexistente }),
      'destinatarioId',
      inexistente,
    );
  });

  it('no registra un aviso con la referencia incompleta', async () => {
    await esperarInvalido(
      aviso({ referencia: { tipo: 'reserva' } as never }),
      'referencia.id',
    );
  });

  describe('duplicados', () => {
    it('no crea otro aviso con el mismo destinatario, módulo, referencia y título', async () => {
      const referencia = { tipo: 'reserva', id: randomUUID() };
      const primero = await avisos.notificar(aviso({ referencia }));
      const segundo = await avisos.notificar(
        aviso({ referencia, mensaje: 'Otro texto para el mismo evento.' }),
      );

      expect(segundo.id).toBe(primero.id);
      expect(
        await prisma.notification.count({
          where: { userId, referenceId: referencia.id },
        }),
      ).toBe(1);
    });

    it('resuelve llamadas simultáneas con un solo aviso', async () => {
      const referencia = { tipo: 'reserva', id: randomUUID() };
      const resultados = await Promise.all(
        Array.from({ length: 5 }, () =>
          avisos.notificar(aviso({ referencia })),
        ),
      );

      expect(new Set(resultados.map((r) => r.id)).size).toBe(1);
      expect(
        await prisma.notification.count({
          where: { userId, referenceId: referencia.id },
        }),
      ).toBe(1);
    });

    it('sí registra dos avisos con la misma referencia y distinto título', async () => {
      const referencia = { tipo: 'pago', id: randomUUID() };
      const a = await avisos.notificar(
        aviso({ referencia, titulo: 'Pago aprobado' }),
      );
      const b = await avisos.notificar(
        aviso({ referencia, titulo: 'Pago confirmado' }),
      );
      expect(a.id).not.toBe(b.id);
    });

    it('no deduplica los avisos sin referencia', async () => {
      const titulo = `Mensaje nuevo ${randomUUID()}`;
      const a = await avisos.notificar(aviso({ titulo, referencia: null }));
      const b = await avisos.notificar(aviso({ titulo, referencia: null }));
      expect(a.id).not.toBe(b.id);
    });
  });
});

describe('servicio de avisos: sin endpoint público (BE-20.1)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['/api/v1/notificaciones', '/api/v1/avisos'])(
    'POST %s responde 404',
    async (ruta) => {
      await request(app.getHttpServer())
        .post(ruta)
        .send({
          destinatarioId: randomUUID(),
          titulo: 'Intento externo',
          mensaje: 'No debería registrarse.',
          moduloOrigen: 'RESERVAS',
        })
        .expect(404);
    },
  );
});
