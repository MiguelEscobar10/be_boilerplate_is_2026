import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';

/**
 * QA-03.1 (MP4-51): pruebas de H03 (solicitar una reserva): fechas,
 * disponibilidad, costo, permisos y aviso al arrendador.
 *
 * Cada caso tiene un id (S01, S02...) que se repite en la evidencia de
 * docs/qa/QA-03.1-solicitudes.md. Las cuentas se crean con el registro real y
 * las sesiones con el login real. Además de la respuesta HTTP, cada caso revisa
 * lo que quedó guardado: la reserva, el costo, los avisos y la disponibilidad
 * pública.
 *
 * Las reservas que ocupan fechas y los bloqueos se crean directo en la base.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Session = { token: string; userId: string };

describe('QA-03.1: solicitar una reserva', () => {
  const email = `qa-03.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let prisma: import('../../src/prisma/services/prisma.service.js').PrismaService;
  let landlord: Session;
  let otherLandlord: Session;
  let tenant: Session;
  let other: Session;
  let accounts = 0;
  // Cada caso usa días distintos (a partir de 2031) para que no se crucen.
  let nextDay = 0;

  const http = () => request(app.getHttpServer());
  const auth = (req: request.Test, who: Session | null) =>
    who ? req.set('Authorization', `Bearer ${who.token}`) : req;

  const account = async (
    rol: 'ARRENDATARIO' | 'ARRENDADOR',
    nombre: string,
  ) => {
    const address = `${rol.toLowerCase()}${++accounts}-${email}`;
    await http()
      .post('/api/v1/users')
      .send({ email: address, password, rol, nombre, telefono: '70001234' })
      .expect(201);
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: address, password })
      .expect(200);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: address },
    });
    return { token: res.body.accessToken as string, userId: user.id };
  };

  const newListing = async (
    extra: {
      rateAmount?: string;
      rateUnit?: 'HORA' | 'DIA' | 'NOCHE' | 'SEMANA';
      isActive?: boolean;
      requiresVerification?: boolean;
    } = {},
    owner = landlord,
  ) =>
    (
      await prisma.listing.create({
        data: {
          landlordId: owner.userId,
          type: 'EQUIPO',
          name: 'Proyector Epson',
          location: 'Antiguo Cuscatlán',
          rateAmount: extra.rateAmount ?? '15.00',
          rateUnit: extra.rateUnit ?? 'HORA',
          depositAmount: '20.00',
          isActive: extra.isActive ?? true,
          requiresVerification: extra.requiresVerification ?? false,
        },
      })
    ).id;

  /** Un día libre nuevo, a las 00:00 de El Salvador. */
  const freshDay = () =>
    new Date(Date.UTC(2031, 0, 1) + 6 * HOUR + nextDay++ * DAY);
  /** El instante como lo escribe la API, con la zona de El Salvador. */
  const iso = (d: Date) =>
    `${new Date(d.getTime() - 6 * HOUR).toISOString().slice(0, 19)}-06:00`;
  const at = (day: Date, hours: number) =>
    new Date(day.getTime() + hours * HOUR);

  const solicitar = (
    body: Record<string, unknown>,
    who: Session | null = tenant,
  ) => auth(http().post('/api/v1/reservas').send(body), who);
  const pedir = (
    listingId: string,
    start: Date,
    end: Date,
    who: Session | null = tenant,
  ) =>
    solicitar(
      { publicacionId: listingId, inicio: iso(start), fin: iso(end) },
      who,
    );
  const detalle = (id: string, who: Session | null = tenant) =>
    auth(http().get(`/api/v1/reservas/${id}`), who);

  const ocupar = (
    listingId: string,
    startAt: Date,
    endAt: Date,
    status: 'CONFIRMADA' | 'EN_CURSO' | 'PENDIENTE' = 'CONFIRMADA',
  ) =>
    prisma.reservation.create({
      data: {
        listingId,
        tenantId: other.userId,
        startAt,
        endAt,
        status,
        rentalCost: '10.00',
        depositAmount: '0.00',
      },
    });

  const guardadas = (listingId: string) =>
    prisma.reservation.count({ where: { listingId, tenantId: tenant.userId } });
  const avisosDe = (userId: string) =>
    prisma.notification.count({ where: { userId } });

  const ocupados = async (listingId: string, day: Date) => {
    const d = iso(day).slice(0, 10);
    const res = await http()
      .get(`/api/v1/publicaciones/${listingId}/disponibilidad`)
      .query({ desde: d, hasta: d })
      .expect(200);
    return res.body.ocupados as { origen: string }[];
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl();
    const { AppModule } = await import('../../src/app.module.js');
    const { PrismaService } =
      await import('../../src/prisma/services/prisma.service.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    landlord = await account('ARRENDADOR', 'Henry Arrendador');
    otherLandlord = await account('ARRENDADOR', 'Otro Arrendador');
    tenant = await account('ARRENDATARIO', 'Ana Pérez');
    other = await account('ARRENDATARIO', 'Bruno Díaz');
  });

  afterAll(async () => {
    await prisma.reservation.deleteMany({
      where: { tenant: { email: { endsWith: email } } },
    });
    await prisma.listing.deleteMany({
      where: { landlord: { email: { endsWith: email } } },
    });
    await prisma.identityVerification.deleteMany({
      where: { user: { email: { endsWith: email } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await app.close();
  });

  describe('solicitud válida y disponibilidad', () => {
    it('S01: una solicitud válida queda PENDIENTE, con el costo del servidor, y no aparta fechas', async () => {
      const id = await newListing();
      const day = freshDay();

      const res = await pedir(id, at(day, 9), at(day, 12)).expect(201);

      expect(res.body).toMatchObject({
        estado: 'PENDIENTE',
        publicacion: { id, nombre: 'Proyector Epson' },
        costoAlquiler: '45.00',
        depositoMonto: '20.00',
      });
      const r = await prisma.reservation.findUniqueOrThrow({
        where: { id: res.body.id as string },
      });
      expect(r).toMatchObject({
        status: 'PENDIENTE',
        tenantId: tenant.userId,
        startAt: at(day, 9),
        endAt: at(day, 12),
        decidedAt: null,
      });
      expect(await ocupados(id, day)).toHaveLength(0);
    });

    it('S02: dos personas piden las mismas fechas a la vez y las dos quedan PENDIENTE', async () => {
      const id = await newListing();
      const day = freshDay();

      const [a, b] = await Promise.all([
        pedir(id, at(day, 9), at(day, 12), tenant),
        pedir(id, at(day, 9), at(day, 12), other),
      ]);

      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.id).not.toBe(b.body.id);
      expect(await prisma.reservation.count({ where: { listingId: id } })).toBe(
        2,
      );
    });

    it('S03: un período que se cruza con una CONFIRMADA o EN_CURSO da 409 y no guarda nada', async () => {
      for (const status of ['CONFIRMADA', 'EN_CURSO'] as const) {
        const id = await newListing();
        const day = freshDay();
        await ocupar(id, at(day, 9), at(day, 12), status);

        const res = await pedir(id, at(day, 10), at(day, 11)).expect(409);

        expect(res.body).toMatchObject({ codigo: 'PERIODO_NO_DISPONIBLE' });
        expect(await guardadas(id), status).toBe(0);
      }
    });

    it('S04: el 409 vale para cruce parcial, contenido y que lo contiene; el borde no choca', async () => {
      const id = await newListing();
      const day = freshDay();
      await ocupar(id, at(day, 10), at(day, 14));

      await pedir(id, at(day, 8), at(day, 11)).expect(409); // por el inicio
      await pedir(id, at(day, 13), at(day, 16)).expect(409); // por el fin
      await pedir(id, at(day, 11), at(day, 12)).expect(409); // dentro
      await pedir(id, at(day, 9), at(day, 15)).expect(409); // lo contiene
      expect(await guardadas(id)).toBe(0);

      await pedir(id, at(day, 8), at(day, 10)).expect(201); // termina donde empieza
      await pedir(id, at(day, 14), at(day, 16)).expect(201); // empieza donde termina
    });

    it('S05: un bloqueo del arrendador da el mismo 409, sin revelar el motivo', async () => {
      const id = await newListing();
      const day = freshDay();
      await prisma.availabilityBlock.create({
        data: {
          listingId: id,
          createdById: landlord.userId,
          startAt: at(day, 0),
          endAt: at(day, 24),
          reason: 'Mantenimiento privado',
        },
      });

      const res = await pedir(id, at(day, 9), at(day, 12)).expect(409);

      expect(res.body).toMatchObject({ codigo: 'PERIODO_NO_DISPONIBLE' });
      expect(JSON.stringify(res.body)).not.toContain('Mantenimiento');
      expect(await guardadas(id)).toBe(0);
    });

    it('S06: solo CONFIRMADA y EN_CURSO ocupan; PENDIENTE, RECHAZADA, CANCELADA y COMPLETADA no', async () => {
      const id = await newListing();
      const day = freshDay();
      for (const status of [
        'PENDIENTE',
        'RECHAZADA',
        'CANCELADA',
        'COMPLETADA',
      ] as const) {
        await prisma.reservation.create({
          data: {
            listingId: id,
            tenantId: other.userId,
            startAt: at(day, 9),
            endAt: at(day, 12),
            status,
            rentalCost: '10.00',
            depositAmount: '0.00',
          },
        });
      }

      await pedir(id, at(day, 9), at(day, 12)).expect(201);
    });

    it('S07: lo que la disponibilidad pública muestra como ocupado, la solicitud lo rechaza', async () => {
      const id = await newListing();
      const day = freshDay();
      await ocupar(id, at(day, 9), at(day, 12));

      expect((await ocupados(id, day)).length).toBeGreaterThan(0);
      await pedir(id, at(day, 9), at(day, 12)).expect(409);

      const libre = freshDay();
      expect(await ocupados(id, libre)).toHaveLength(0);
      await pedir(id, at(libre, 9), at(libre, 12)).expect(201);
    });
  });

  describe('fechas', () => {
    it('S08: un inicio que ya pasó da 400 FECHA_PASADA y no guarda nada', async () => {
      const id = await newListing();
      const antes = await avisosDe(landlord.userId);

      const res = await solicitar({
        publicacionId: id,
        inicio: '2020-01-10T09:00:00-06:00',
        fin: '2020-01-10T12:00:00-06:00',
      }).expect(400);

      expect(res.body).toMatchObject({ codigo: 'FECHA_PASADA' });
      expect(await guardadas(id)).toBe(0);
      expect(await avisosDe(landlord.userId)).toBe(antes);
    });

    it('S09: un inicio apenas en el pasado también se rechaza; uno futuro cercano se acepta', async () => {
      const id = await newListing();
      const hace = new Date(Date.now() - 60_000);

      const res = await pedir(id, hace, at(hace, 3)).expect(400);
      expect(res.body).toMatchObject({ codigo: 'FECHA_PASADA' });

      const luego = new Date(Date.now() + 10 * 60_000);
      await pedir(id, luego, at(luego, 3)).expect(201);
    });

    it('S10: fin anterior o igual al inicio, fechas sin zona o inexistentes dan 400', async () => {
      const id = await newListing();
      const day = freshDay();
      const base = { publicacionId: id };

      await pedir(id, at(day, 12), at(day, 9)).expect(400);
      await pedir(id, at(day, 9), at(day, 9)).expect(400);
      await solicitar({
        ...base,
        inicio: '2031-06-10T09:00:00',
        fin: '2031-06-10T12:00:00',
      }).expect(400);
      await solicitar({
        ...base,
        inicio: '2031-02-30T09:00:00-06:00',
        fin: '2031-03-01T12:00:00-06:00',
      }).expect(400);
      await solicitar({ ...base, inicio: 'mañana', fin: 'pasado' }).expect(400);
      await solicitar(base).expect(400);
      expect(await guardadas(id)).toBe(0);
    });
  });

  describe('costo', () => {
    it('S11: el costo sale de la tarifa y la duración en cada unidad, y la fracción sube', async () => {
      const casos: Array<[string, string, string, number, number, string]> = [
        // unidad, tarifa, descripción, horas de inicio, horas de fin, costo
        ['HORA', '15.00', '3 h', 9, 12, '45.00'],
        ['HORA', '15.00', '2 h 10 min', 9, 11.1667, '45.00'],
        ['HORA', '15.00', '30 min (mínimo 1)', 9, 9.5, '15.00'],
        ['DIA', '25.00', '2 días', 0, 48, '50.00'],
        ['DIA', '25.00', '2 días y 1 h', 0, 49, '75.00'],
        ['NOCHE', '30.00', '2 noches', 14, 62, '60.00'],
        ['SEMANA', '100.00', '1 semana', 0, 168, '100.00'],
        ['SEMANA', '100.00', '1 semana y 1 h', 0, 169, '200.00'],
        ['HORA', '15.10', '3 h con centavos', 9, 12, '45.30'],
      ];
      for (const [rateUnit, rateAmount, que, desde, hasta, costo] of casos) {
        const id = await newListing({
          rateUnit: rateUnit as 'HORA',
          rateAmount,
        });
        const day = freshDay();
        const res = await pedir(id, at(day, desde), at(day, hasta)).expect(201);
        expect(
          [rateUnit, que, res.body.costoAlquiler],
          `${rateUnit} ${que}`,
        ).toEqual([rateUnit, que, costo]);
      }
    });

    it('S12: el cliente no puede mandar el costo; el 400 no guarda nada', async () => {
      const id = await newListing();
      const day = freshDay();

      await solicitar({
        publicacionId: id,
        inicio: iso(at(day, 9)),
        fin: iso(at(day, 12)),
        costoAlquiler: '1.00',
      }).expect(400);

      expect(await guardadas(id)).toBe(0);
    });

    it('S13: la reserva conserva el precio de cuando se pidió aunque la tarifa cambie', async () => {
      const id = await newListing();
      const day = freshDay();
      const res = await pedir(id, at(day, 9), at(day, 12)).expect(201);

      await prisma.listing.update({
        where: { id },
        data: { rateAmount: '99.00', depositAmount: '500.00' },
      });

      const vista = await detalle(res.body.id as string).expect(200);
      expect(vista.body).toMatchObject({
        costoAlquiler: '45.00',
        depositoMonto: '20.00',
      });
    });
  });

  describe('permisos y consulta', () => {
    it('S14: sin sesión es 401 y un arrendador no puede solicitar (403)', async () => {
      const id = await newListing();
      const day = freshDay();
      await pedir(id, at(day, 9), at(day, 12), null).expect(401);
      await pedir(id, at(day, 9), at(day, 12), landlord).expect(403);
      await pedir(id, at(day, 9), at(day, 12), otherLandlord).expect(403);
      expect(await prisma.reservation.count({ where: { listingId: id } })).toBe(
        0,
      );
    });

    it('S15: una publicación que no existe o está desactivada da 404', async () => {
      const day = freshDay();
      await pedir(randomUUID(), at(day, 9), at(day, 12)).expect(404);
      await solicitar({
        publicacionId: 'no-es-uuid',
        inicio: iso(at(day, 9)),
        fin: iso(at(day, 12)),
      }).expect(400);

      const apagada = await newListing({ isActive: false });
      await pedir(apagada, at(day, 9), at(day, 12)).expect(404);
      expect(await guardadas(apagada)).toBe(0);
    });

    it('S16: quien solicitó y el dueño del bien ven la reserva; cualquier otra persona recibe 404', async () => {
      const id = await newListing();
      const day = freshDay();
      const res = await pedir(id, at(day, 9), at(day, 12)).expect(201);
      const reserva = res.body.id as string;

      await detalle(reserva, tenant).expect(200);
      await detalle(reserva, landlord).expect(200);

      const ajeno = await detalle(reserva, other).expect(404);
      const otroDueno = await detalle(reserva, otherLandlord).expect(404);
      const noExiste = await detalle(randomUUID(), other).expect(404);
      expect(ajeno.body).not.toHaveProperty('codigo');
      expect(ajeno.body.message).toBe(noExiste.body.message);
      expect(otroDueno.body.message).toBe(noExiste.body.message);
      await detalle(reserva, null).expect(401);
    });

    it('S17: el detalle trae estado, fechas, costo y depósito aparte, y el motivo si la rechazaron', async () => {
      const id = await newListing();
      const day = freshDay();
      const res = await pedir(id, at(day, 9), at(day, 12)).expect(201);
      const reserva = res.body.id as string;

      const nueva = await detalle(reserva).expect(200);
      expect(nueva.body).toMatchObject({
        estado: 'PENDIENTE',
        inicio: iso(at(day, 9)),
        fin: iso(at(day, 12)),
        costoAlquiler: '45.00',
        depositoMonto: '20.00',
        decididaAt: null,
        motivoRechazo: null,
      });

      await prisma.reservation.update({
        where: { id: reserva },
        data: {
          status: 'RECHAZADA',
          decidedAt: new Date(),
          decidedById: landlord.userId,
          rejectionReason: 'No hay equipo esa semana',
        },
      });
      const rechazada = await detalle(reserva).expect(200);
      expect(rechazada.body).toMatchObject({
        estado: 'RECHAZADA',
        motivoRechazo: 'No hay equipo esa semana',
      });
      expect(rechazada.body.decididaAt).toEqual(expect.any(String));
    });
  });

  describe('aviso al arrendador', () => {
    it('S18: el arrendador recibe «Nueva solicitud de reserva» con el bien y las fechas; nadie más', async () => {
      const id = await newListing();
      const day = freshDay();
      const antes = {
        otro: await prisma.notification.count({
          where: { userId: otherLandlord.userId },
        }),
        ana: await prisma.notification.count({
          where: { userId: tenant.userId },
        }),
      };

      const res = await pedir(id, at(day, 9), at(day, 12)).expect(201);

      const avisos = await prisma.notification.findMany({
        where: { userId: landlord.userId, referenceId: res.body.id as string },
      });
      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toMatchObject({
        sourceModule: 'RESERVAS',
        title: 'Nueva solicitud de reserva',
        referenceType: 'reserva',
        readAt: null,
      });
      expect(avisos[0].message).toContain('Proyector Epson');
      // Las fechas del aviso van en hora de El Salvador (dd/mm/aaaa hh:mm).
      const dia = new Date(at(day, 9).getTime() - 6 * HOUR);
      const esperado = `${String(dia.getUTCDate()).padStart(2, '0')}/${String(dia.getUTCMonth() + 1).padStart(2, '0')}/${dia.getUTCFullYear()} 09:00`;
      expect(avisos[0].message).toContain(esperado);
      expect(avisos[0].message).toContain('12:00');
      expect(
        await prisma.notification.count({
          where: { userId: otherLandlord.userId },
        }),
      ).toBe(antes.otro);
      expect(
        await prisma.notification.count({ where: { userId: tenant.userId } }),
      ).toBe(antes.ana);
    });

    it('S19: una solicitud rechazada por el servidor (409, 400, 404) no avisa a nadie', async () => {
      const id = await newListing();
      const day = freshDay();
      await ocupar(id, at(day, 9), at(day, 12));
      const antes = await prisma.notification.count({
        where: { userId: landlord.userId },
      });

      await pedir(id, at(day, 10), at(day, 11)).expect(409);
      await pedir(id, at(day, 12), at(day, 9)).expect(400);
      await pedir(randomUUID(), at(day, 9), at(day, 12)).expect(404);

      expect(
        await prisma.notification.count({ where: { userId: landlord.userId } }),
      ).toBe(antes);
    });
  });

  describe('verificación de identidad', () => {
    it('S20: si el bien la exige, sin verificación o con una PENDIENTE da 422 y no guarda', async () => {
      const id = await newListing({ requiresVerification: true });
      const day = freshDay();

      const sin = await pedir(id, at(day, 9), at(day, 12)).expect(422);
      expect(sin.body).toMatchObject({ codigo: 'VERIFICACION_REQUERIDA' });

      await prisma.identityVerification.create({
        data: {
          userId: tenant.userId,
          documentKey: 'v/pendiente.pdf',
          status: 'PENDIENTE',
        },
      });
      await pedir(id, at(day, 9), at(day, 12)).expect(422);
      expect(await guardadas(id)).toBe(0);
    });

    it('S21: con la verificación APROBADA se registra, y si el bien no la exige no hace falta', async () => {
      const id = await newListing({ requiresVerification: true });
      const day = freshDay();
      await prisma.identityVerification.create({
        data: {
          userId: other.userId,
          documentKey: 'v/aprobada.pdf',
          status: 'APROBADA',
          submittedAt: new Date('2030-01-01T00:00:00Z'),
          reviewedById: landlord.userId,
          reviewedAt: new Date('2030-01-02T00:00:00Z'),
        },
      });
      await pedir(id, at(day, 9), at(day, 12), other).expect(201);

      const libre = await newListing({ requiresVerification: false });
      await pedir(libre, at(day, 9), at(day, 12)).expect(201);
    });

    it('S22: la verificación se revisa antes que la disponibilidad', async () => {
      const id = await newListing({ requiresVerification: true });
      const day = freshDay();
      await ocupar(id, at(day, 9), at(day, 12));

      const res = await pedir(id, at(day, 10), at(day, 11)).expect(422);

      expect(res.body).toMatchObject({ codigo: 'VERIFICACION_REQUERIDA' });
    });
  });
});
