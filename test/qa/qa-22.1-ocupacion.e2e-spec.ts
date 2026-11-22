import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { ReservationStatus } from '@PrismaClient';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';

/**
 * QA-22.1 (MP4-122): plan de pruebas de la tasa de ocupación y sus permisos
 * (H22).
 *
 * Cada caso tiene un id (O01, O02...) que se repite en la evidencia de
 * docs/qa/QA-22.1-ocupacion.md. Los casos que prueban un criterio de
 * aceptación de H22 empiezan con «ACn:» y conservan su id al final, entre
 * paréntesis. Cada bien se arma con reservas y bloqueos
 * creados directo en la base, y la tasa esperada se calcula a mano en el
 * caso. Los bloqueos se crean en la base porque BE-14.1 todavía no está en
 * main. Fechas en UTC: El Salvador es UTC-6, así que la medianoche local del
 * día `d` de noviembre es `nov(d)`.
 */
const nov = (d: number, hour = 0) => new Date(Date.UTC(2026, 10, d, hour + 6));
const NOVIEMBRE = 'desde=2026-11-01&hasta=2026-11-30';

type Session = { token: string; userId: string };
type Item = {
  publicacionId: string;
  nombre: string;
  diasOcupados: number;
  diasDisponibles: number;
  tasaOcupacion: number;
};

describe('H22. Ver la tasa de ocupación de cada bien', () => {
  const email = `qa-22.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let prisma: import('../../src/prisma/services/prisma.service.js').PrismaService;
  let tenant: Session;
  let accounts = 0;

  const http = () => request(app.getHttpServer());

  const login = async (address: string): Promise<Session> => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: address, password })
      .expect(200);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: address },
    });
    return { token: res.body.accessToken as string, userId: user.id };
  };

  const account = async (rol: 'ARRENDATARIO' | 'ARRENDADOR') => {
    const address = `${rol === 'ARRENDADOR' ? 'dueno' : 'inquilino'}${++accounts}-${email}`;
    await http()
      .post('/api/v1/users')
      .send({
        email: address,
        password,
        rol,
        nombre: `Persona ${accounts}`,
        telefono: '70001234',
      })
      .expect(201);
    return login(address);
  };

  const listing = async (
    owner: Session,
    name = 'Bien',
    isActive = true,
  ): Promise<string> =>
    (
      await prisma.listing.create({
        data: {
          landlordId: owner.userId,
          type: 'EQUIPO',
          name,
          location: 'San Salvador',
          rateAmount: '10.00',
          rateUnit: 'DIA',
          isActive,
        },
      })
    ).id;

  const reserve = (
    listingId: string,
    startAt: Date,
    endAt: Date,
    status: ReservationStatus = 'CONFIRMADA',
  ) =>
    prisma.reservation.create({
      data: {
        listingId,
        tenantId: tenant.userId,
        startAt,
        endAt,
        status,
        rentalCost: '10.00',
        depositAmount: '0.00',
      },
    });

  const block = (listingId: string, startAt: Date, endAt: Date) =>
    prisma.availabilityBlock.create({ data: { listingId, startAt, endAt } });

  const report = (who: Session | null, qs = NOVIEMBRE) => {
    const req = http().get(`/api/v1/reportes/ocupacion${qs ? `?${qs}` : ''}`);
    if (who) void req.set('Authorization', `Bearer ${who.token}`);
    return req;
  };

  /** El renglón del bien en el reporte de noviembre de su dueño. */
  const itemOf = async (owner: Session, id: string, qs = NOVIEMBRE) => {
    const { body } = await report(owner, qs).expect(200);
    const item = (body.items as Item[]).find((i) => i.publicacionId === id);
    if (!item) throw new Error('El bien no aparece en el reporte');
    return item;
  };

  /** Arrendador nuevo con un solo bien, para que cada caso sea independiente. */
  const scenario = async (name = 'Bien') => {
    const owner = await account('ARRENDADOR');
    return { owner, id: await listing(owner, name) };
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
    tenant = await account('ARRENDATARIO');
  });

  afterAll(async () => {
    await prisma.reservation.deleteMany({
      where: { tenant: { email: { endsWith: email } } },
    });
    await prisma.listing.deleteMany({
      where: { landlord: { email: { endsWith: email } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await app.close();
  });

  describe('fórmula', () => {
    it('AC1: la tasa de cada bien coincide con el cálculo manual (6 ocupados / 28 disponibles = 21.4, un decimal) (O01)', async () => {
      const { owner, id } = await scenario('Taladro');
      await reserve(id, nov(3), nov(9)); // días 3 a 8
      await block(id, nov(20), nov(22)); // días 20 y 21

      expect(await itemOf(owner, id)).toEqual({
        publicacionId: id,
        nombre: 'Taladro',
        diasOcupados: 6,
        diasDisponibles: 28,
        tasaOcupacion: 21.4,
      });
    });

    it.each([
      // [días ocupados, días bloqueados, tasa a mano]
      [10, 0, 33.3], // 10/30 = 33.33
      [20, 0, 66.7], // 20/30 = 66.67
      [1, 0, 3.3], // 1/30 = 3.33
      [30, 0, 100], // todo el mes
      [7, 2, 25], // 7/28
    ])(
      'O02: %i ocupados con %i bloqueados da %d (un decimal, redondeo a la mitad)',
      async (occupied, blocked, rate) => {
        const { owner, id } = await scenario();
        await reserve(id, nov(1), nov(1 + occupied));
        if (blocked) await block(id, nov(31 - blocked), nov(31));

        expect(await itemOf(owner, id)).toMatchObject({
          diasOcupados: occupied,
          diasDisponibles: 30 - blocked,
          tasaOcupacion: rate,
        });
      },
    );

    it('AC4: un bien sin reservas en el período muestra 0 % (O03)', async () => {
      const { owner, id } = await scenario();
      expect(await itemOf(owner, id)).toMatchObject({
        diasOcupados: 0,
        diasDisponibles: 30,
        tasaOcupacion: 0,
      });
    });

    it('O04: sin días disponibles (todo bloqueado) la tasa es 0, sin dividir por cero', async () => {
      const { owner, id } = await scenario();
      await block(id, nov(1), nov(31));
      await reserve(id, nov(5), nov(8));

      expect(await itemOf(owner, id)).toMatchObject({
        diasOcupados: 0,
        diasDisponibles: 0,
        tasaOcupacion: 0,
      });
    });
  });

  describe('estados, traslapes y bloqueos', () => {
    it('AC3: las reservas PENDIENTE, RECHAZADA y CANCELADA no suman días ocupados; solo CONFIRMADA, EN_CURSO y COMPLETADA (O05)', async () => {
      const { owner, id } = await scenario();
      const statuses: ReservationStatus[] = [
        'PENDIENTE',
        'RECHAZADA',
        'CANCELADA',
        'CONFIRMADA',
        'EN_CURSO',
        'COMPLETADA',
      ];
      for (const [i, status] of statuses.entries()) {
        await reserve(id, nov(1 + 2 * i, 9), nov(1 + 2 * i, 15), status);
      }

      expect(await itemOf(owner, id)).toMatchObject({
        diasOcupados: 3,
        tasaOcupacion: 10,
      });
    });

    it('O06: reservas que se cruzan cuentan cada día una sola vez', async () => {
      const { owner, id } = await scenario();
      await reserve(id, nov(3, 10), nov(6, 10)); // 3-6
      await reserve(id, nov(5, 8), nov(8, 9), 'COMPLETADA'); // 5-8
      await reserve(id, nov(4), nov(5), 'EN_CURSO'); // 4, dentro de la primera

      expect(await itemOf(owner, id)).toMatchObject({
        diasOcupados: 6,
        tasaOcupacion: 20,
      });
    });

    it('AC2: los días bloqueados no cuentan como disponibles ni como ocupados, aunque tengan reserva (O07)', async () => {
      const { owner, id } = await scenario();
      await reserve(id, nov(1), nov(11)); // días 1 a 10
      await block(id, nov(5), nov(7)); // días 5 y 6

      expect(await itemOf(owner, id)).toMatchObject({
        diasOcupados: 8,
        diasDisponibles: 28,
        tasaOcupacion: 28.6,
      });
    });

    it('O08: los días se cuentan en hora de El Salvador y el fin a medianoche no ocupa el día siguiente', async () => {
      const { owner, id } = await scenario();
      // 30 de noviembre 22:00 local = 1 de diciembre 04:00 UTC: cuenta en noviembre.
      await reserve(
        id,
        new Date('2026-12-01T04:00:00Z'),
        new Date('2026-12-01T05:00:00Z'),
      );
      // Termina a las 00:00 del 12: ocupa 10 y 11.
      await reserve(id, nov(10, 9), nov(12));

      expect(await itemOf(owner, id)).toMatchObject({ diasOcupados: 3 });
      expect(
        await itemOf(owner, id, 'desde=2026-12-01&hasta=2026-12-31'),
      ).toMatchObject({ diasOcupados: 0 });
    });

    it('O09: una reserva que sale del período solo cuenta sus días dentro de él', async () => {
      const { owner, id } = await scenario();
      await reserve(id, new Date('2026-10-20T12:00:00Z'), nov(4, 12)); // hasta el 4

      expect(await itemOf(owner, id)).toMatchObject({ diasOcupados: 4 });
    });
  });

  describe('período', () => {
    it('O10: sin fechas usa el mes en curso (hora de El Salvador)', async () => {
      const { owner } = await scenario();
      const { body } = await report(owner, '').expect(200);
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/El_Salvador',
      }).format(new Date());
      expect(body.desde).toBe(`${today.slice(0, 7)}-01`);
      expect(body.hasta.slice(0, 7)).toBe(today.slice(0, 7));
    });

    it('O11: acepta exactamente 366 días', async () => {
      const { owner, id } = await scenario();
      const item = await itemOf(owner, id, 'desde=2028-01-01&hasta=2028-12-31');
      expect(item.diasDisponibles).toBe(366);
    });

    it.each([
      [
        'O12',
        'formato inválido',
        'desde=1/11/2026&hasta=2026-11-30',
        'AAAA-MM-DD',
      ],
      [
        'O13',
        'fecha inexistente',
        'desde=2026-02-29&hasta=2026-03-10',
        'no existe',
      ],
      [
        'O14',
        'desde posterior a hasta',
        'desde=2026-11-30&hasta=2026-11-01',
        'posterior',
      ],
      ['O15', 'rango de 367 días', 'desde=2028-01-01&hasta=2029-01-01', '366'],
    ])('%s: %s responde 400', async (_, __, qs, message) => {
      const { owner } = await scenario();
      const { body } = await report(owner, qs).expect(400);
      expect(JSON.stringify(body.message)).toContain(message);
    });
  });

  describe('permisos', () => {
    it('AC5: cada arrendador ve solo sus bienes, incluidos los inactivos (O16)', async () => {
      const a = await account('ARRENDADOR');
      const b = await account('ARRENDADOR');
      const activo = await listing(a, 'Activo');
      const inactivo = await listing(a, 'Inactivo', false);
      const ajeno = await listing(b, 'Ajeno');
      await reserve(ajeno, nov(1), nov(10));

      const { body: deA } = await report(a).expect(200);
      expect((deA.items as Item[]).map((i) => i.publicacionId).sort()).toEqual(
        [activo, inactivo].sort(),
      );
      const { body: deB } = await report(b).expect(200);
      expect(deB.items).toEqual([
        expect.objectContaining({ publicacionId: ajeno, diasOcupados: 9 }),
      ]);
    });

    it('AC6: el arrendatario no puede abrir el reporte: 403 aunque tenga reservas (O17)', async () => {
      const { id } = await scenario();
      await reserve(id, nov(1), nov(5));
      const { body } = await report(tenant).expect(403);
      expect(JSON.stringify(body)).not.toContain(id);
    });

    it('O18: el REVISOR recibe 403', async () => {
      const address = `revisor-${email}`;
      await prisma.user.create({
        data: {
          email: address,
          passwordHash: await bcrypt.hash(password, 4),
          role: 'REVISOR',
        },
      });
      await report(await login(address)).expect(403);
    });

    it('O19: sin sesión o con un token inválido responde 401', async () => {
      await report(null).expect(401);
      await report({ token: 'no-es-un-token', userId: '' }).expect(401);
    });

    it('O20: no se puede pedir el reporte de otro arrendador por parámetro', async () => {
      const { owner } = await scenario();
      const other = await scenario();
      await report(
        owner,
        `${NOVIEMBRE}&landlordId=${other.owner.userId}`,
      ).expect(400);
    });
  });
});
