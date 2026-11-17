import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '@Prisma/services';
import { ModuloOrigen } from '@Notifications/types';
import { createTestPrismaClient } from './helpers/test-database.js';

/**
 * Bandeja de notificaciones (BE-10.1) con la app completa contra la base de
 * pruebas (ver test/helpers/test-database.ts).
 *
 * Crea dos usuarios con email único y firma sus tokens con el JwtService de la
 * app. Antes de cada prueba vuelve a sembrar sus notificaciones con fechas
 * fijas, así el orden esperado no depende del reloj. En afterAll borra solo
 * esos usuarios (la cascada se lleva sus notificaciones).
 */
const prisma = createTestPrismaClient();
const RUTA = '/api/v1/notificaciones';
/** Fecha de lectura de las que se siembran ya leídas. */
const LEIDA_ANTES = new Date('2026-11-01T08:00:00.000Z');

/** Minuto `n` de una hora fija: la notificación `n` es más nueva que la `n-1`. */
const minuto = (n: number) => new Date(Date.UTC(2026, 10, 15, 10, n, 0, 0));

describe('bandeja de notificaciones (BE-10.1)', () => {
  const sufijo = `be-10.1-${randomUUID()}@test.local`;
  let app: INestApplication;
  let usuarioA: { id: string; token: string };
  let usuarioB: { id: string; token: string };
  /** Ids de A, de la más reciente a la más antigua. */
  let idsA: string[];
  let idsB: string[];

  const get = (ruta: string, token = usuarioA.token) =>
    request(app.getHttpServer())
      .get(ruta)
      .set('Authorization', `Bearer ${token}`);
  const marcar = (id: string, token = usuarioA.token) =>
    request(app.getHttpServer())
      .patch(`${RUTA}/${id}/leida`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    // Mismas opciones que main.ts.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    const jwt = app.get(JwtService);
    const crear = async (nombre: string) => {
      const email = `${nombre}-${sufijo}`;
      const { id } = await prisma.user.create({
        data: { email, passwordHash: 'no-es-un-hash-real' },
      });
      return { id, token: await jwt.signAsync({ sub: id, email }) };
    };
    usuarioA = await crear('a');
    usuarioB = await crear('b');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: sufijo } } });
    await app.close();
    await prisma.$disconnect();
  });

  /**
   * A: 5 notificaciones (minutos 1 a 5); las dos más antiguas ya leídas.
   * B: 2 notificaciones no leídas, intercaladas en el tiempo con las de A.
   */
  beforeEach(async () => {
    await prisma.notification.deleteMany({
      where: { userId: { in: [usuarioA.id, usuarioB.id] } },
    });

    const sembrar = async (
      userId: string,
      minutos: number[],
      leidas: number[],
    ) => {
      const ids: string[] = [];
      for (const n of minutos) {
        const { id } = await prisma.notification.create({
          data: {
            userId,
            sourceModule: ModuloOrigen.RESERVAS,
            title: `Aviso ${n}`,
            message: `Mensaje del aviso ${n}.`,
            referenceType: n % 2 === 0 ? 'reserva' : null,
            referenceId: n % 2 === 0 ? `r-${n}` : null,
            createdAt: minuto(n),
            readAt: leidas.includes(n) ? LEIDA_ANTES : null,
          },
          select: { id: true },
        });
        ids.push(id);
      }
      return ids.reverse();
    };

    idsA = await sembrar(usuarioA.id, [1, 2, 3, 4, 5], [1, 2]);
    idsB = await sembrar(usuarioB.id, [6, 7], []);
  });

  describe('sin sesión', () => {
    it.each([
      ['GET', RUTA],
      ['GET', `${RUTA}/no-leidas/conteo`],
      ['PATCH', `${RUTA}/${randomUUID()}/leida`],
    ])('%s %s responde 401', async (metodo, ruta) => {
      const req = request(app.getHttpServer());
      await (metodo === 'GET' ? req.get(ruta) : req.patch(ruta)).expect(401);
    });

    it('un token inválido responde 401', async () => {
      await get(RUTA, 'no-es-un-jwt').expect(401);
    });
  });

  describe('GET /notificaciones', () => {
    it('devuelve solo las del usuario, más recientes primero', async () => {
      const { body } = await get(RUTA).expect(200);

      expect(body.total).toBe(5);
      expect(body.items.map((n: { id: string }) => n.id)).toEqual(idsA);
      for (const id of idsB) {
        expect(JSON.stringify(body)).not.toContain(id);
      }
    });

    it('cada item tiene la forma del contrato', async () => {
      const { body } = await get(RUTA).expect(200);

      // La más reciente: minuto 5, sin referencia (impar), no leída.
      expect(body.items[0]).toEqual({
        id: idsA[0],
        moduloOrigen: 'RESERVAS',
        titulo: 'Aviso 5',
        mensaje: 'Mensaje del aviso 5.',
        referencia: null,
        leidaAt: null,
        creadaAt: minuto(5).toISOString(),
      });
      // Minuto 4: con referencia.
      expect(body.items[1].referencia).toEqual({ tipo: 'reserva', id: 'r-4' });
      // Minuto 1: leída.
      expect(body.items[4].leidaAt).toBe(LEIDA_ANTES.toISOString());
    });

    it('soloNoLeidas=true filtra y el total cuenta el filtro', async () => {
      const { body } = await get(`${RUTA}?soloNoLeidas=true`).expect(200);

      expect(body.total).toBe(3);
      expect(body.items.map((n: { id: string }) => n.id)).toEqual(
        idsA.slice(0, 3),
      );
    });

    it('soloNoLeidas=false devuelve todas', async () => {
      const { body } = await get(`${RUTA}?soloNoLeidas=false`).expect(200);
      expect(body.total).toBe(5);
    });

    it('pagina con page y limit; el total es de todas las páginas', async () => {
      const { body } = await get(`${RUTA}?page=2&limit=2`).expect(200);

      expect(body.total).toBe(5);
      expect(body.items.map((n: { id: string }) => n.id)).toEqual(
        idsA.slice(2, 4),
      );
    });

    it('la última página puede venir incompleta', async () => {
      const { body } = await get(`${RUTA}?page=3&limit=2`).expect(200);
      expect(body.items.map((n: { id: string }) => n.id)).toEqual([idsA[4]]);
    });

    it('una página después de la última da items vacío y el total real', async () => {
      const { body } = await get(`${RUTA}?page=10&limit=2`).expect(200);
      expect(body).toEqual({ items: [], total: 5 });
    });

    it('pagina sobre el filtro de no leídas', async () => {
      const { body } = await get(
        `${RUTA}?soloNoLeidas=true&page=2&limit=2`,
      ).expect(200);
      expect(body).toMatchObject({ total: 3 });
      expect(body.items.map((n: { id: string }) => n.id)).toEqual([idsA[2]]);
    });

    it.each([
      'page=0',
      'page=-1',
      'page=1.5',
      'page=abc',
      'page=',
      'page=10001',
      'limit=0',
      'limit=101',
      'limit=abc',
      'soloNoLeidas=si',
      'soloNoLeidas=1',
      'soloNoleidas=true',
      'orden=asc',
    ])('?%s responde 400', async (query) => {
      await get(`${RUTA}?${query}`).expect(400);
    });

    it('acepta los máximos', async () => {
      await get(`${RUTA}?page=10000&limit=100`).expect(200);
    });
  });

  describe('PATCH /notificaciones/{id}/leida', () => {
    /** readAt de todas las notificaciones de A y B, menos `excepto`. */
    async function lecturasDeLasDemas(excepto: string) {
      return prisma.notification.findMany({
        where: {
          userId: { in: [usuarioA.id, usuarioB.id] },
          id: { not: excepto },
        },
        select: { id: true, readAt: true },
        orderBy: { id: 'asc' },
      });
    }

    it('la marca como leída y responde 200 con leidaAt', async () => {
      const id = idsA[0];
      const antes = Date.now();
      const { body } = await marcar(id).expect(200);

      expect(body).toMatchObject({ id, titulo: 'Aviso 5' });
      expect(Date.parse(body.leidaAt)).toBeGreaterThanOrEqual(antes - 1000);

      const guardada = await prisma.notification.findUniqueOrThrow({
        where: { id },
      });
      expect(guardada.readAt?.toISOString()).toBe(body.leidaAt);
    });

    it('deja de aparecer como pendiente', async () => {
      await marcar(idsA[0]).expect(200);

      const { body } = await get(`${RUTA}?soloNoLeidas=true`).expect(200);
      expect(body.total).toBe(2);
      expect(body.items.map((n: { id: string }) => n.id)).not.toContain(
        idsA[0],
      );
    });

    it('no afecta otras notificaciones', async () => {
      const id = idsA[1];
      const antes = await lecturasDeLasDemas(id);

      await marcar(id).expect(200);

      expect(await lecturasDeLasDemas(id)).toEqual(antes);
    });

    it('marcarla otra vez conserva la fecha de la primera lectura', async () => {
      const primera = await marcar(idsA[0]).expect(200);
      const segunda = await marcar(idsA[0]).expect(200);
      expect(segunda.body.leidaAt).toBe(primera.body.leidaAt);
    });

    it('una ya leída conserva su fecha original', async () => {
      // idsA[4] es la del minuto 1, sembrada como leída.
      const { body } = await marcar(idsA[4]).expect(200);
      expect(body.leidaAt).toBe(LEIDA_ANTES.toISOString());
    });

    it('llamadas simultáneas dejan la misma fecha', async () => {
      const respuestas = await Promise.all(
        Array.from({ length: 5 }, () => marcar(idsA[0])),
      );
      const fechas = new Set(respuestas.map((r) => r.body.leidaAt));
      expect(respuestas.every((r) => r.status === 200)).toBe(true);
      expect(fechas.size).toBe(1);
    });

    it('una ajena responde 404 y no se modifica', async () => {
      const ajena = idsB[0];
      const { body } = await marcar(ajena).expect(404);

      expect(body.message).toBe('La notificación no existe.');
      const guardada = await prisma.notification.findUniqueOrThrow({
        where: { id: ajena },
      });
      expect(guardada.readAt).toBeNull();
    });

    it('una inexistente responde 404 con el mismo mensaje que una ajena', async () => {
      const inexistente = await marcar(randomUUID()).expect(404);
      const ajena = await marcar(idsB[0]).expect(404);
      expect(inexistente.body).toEqual(ajena.body);
    });

    it.each(['123', 'no-leidas', `${randomUUID()}x`])(
      'un id mal formado (%s) responde 400',
      async (id) => {
        const { body } = await marcar(id).expect(400);
        expect(body.message).toBe('El id de la notificación debe ser un UUID.');
      },
    );
  });

  describe('GET /notificaciones/no-leidas/conteo', () => {
    it('cuenta solo las no leídas del usuario autenticado', async () => {
      await expect(
        get(`${RUTA}/no-leidas/conteo`).expect(200),
      ).resolves.toMatchObject({ body: { noLeidas: 3 } });
      await expect(
        get(`${RUTA}/no-leidas/conteo`, usuarioB.token).expect(200),
      ).resolves.toMatchObject({ body: { noLeidas: 2 } });
    });

    it('baja al marcar una como leída, sin cambiar el de otro usuario', async () => {
      await marcar(idsA[0]).expect(200);

      const a = await get(`${RUTA}/no-leidas/conteo`).expect(200);
      const b = await get(`${RUTA}/no-leidas/conteo`, usuarioB.token).expect(
        200,
      );
      expect(a.body).toEqual({ noLeidas: 2 });
      expect(b.body).toEqual({ noLeidas: 2 });
    });

    it('coincide con el total de la bandeja de no leídas', async () => {
      const conteo = await get(`${RUTA}/no-leidas/conteo`).expect(200);
      const bandeja = await get(`${RUTA}?soloNoLeidas=true`).expect(200);
      expect(conteo.body.noLeidas).toBe(bandeja.body.total);
    });
  });
});
