import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from './helpers/test-database.js';

/**
 * Reporte de ingresos (BE-21.1, H21).
 *
 * Levanta la app completa contra la base de pruebas (local y terminada en
 * `_test`), con el reloj fijado para controlar el "mes en curso". Las
 * reservas y los pagos se crean directo en la base. Al final borra solo lo
 * que creó.
 *
 * `sv(m, d, h…)` es una hora de El Salvador (UTC−6) de 2026 como `Date` UTC.
 */
const sv = (m: number, d: number, h = 0, min = 0, s = 0, ms = 0) =>
  new Date(Date.UTC(2026, m - 1, d, h + 6, min, s, ms));
const URL_BASE = '/api/v1/reportes/ingresos';
const NOVIEMBRE = `${URL_BASE}?desde=2026-11-01&hasta=2026-11-30`;

type Report = {
  desde: string;
  hasta: string;
  moneda: string;
  total: string;
  porBien: { publicacionId: string; nombre: string; ingreso: string }[];
};

describe('reporte de ingresos (BE-21.1)', () => {
  const suffix = `be-21.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let prisma: import('../src/prisma/services/prisma.service.js').PrismaService;
  /** Reloj de la app; cada prueba que lo necesite lo mueve. */
  let now = sv(11, 16, 12);
  const clock = { now: () => now };

  type Who = 'landlord' | 'otherLandlord' | 'tenant';
  const tokens = {} as Record<Who, string>;
  const ids = {} as Record<Who, string>;
  /** Publicaciones del arrendador principal, por clave. */
  const listing = {} as Record<
    'taladro' | 'carpa' | 'bordes' | 'antigua' | 'retirada' | 'ajena',
    string
  >;

  const http = () => request(app.getHttpServer());
  const get = (url: string, who: Who = 'landlord') =>
    http()
      .get(url)
      .set({ Authorization: `Bearer ${tokens[who]}` });

  async function createAccount(who: Who, rol: 'ARRENDADOR' | 'ARRENDATARIO') {
    const email = `${who}-${suffix}`;
    const { body } = await http()
      .post('/api/v1/users')
      .send({ email, password, rol, nombre: who, telefono: '70001234' })
      .expect(201);
    ids[who] = body.id;
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    tokens[who] = login.body.accessToken;
  }

  const createListing = async (
    landlordId: string,
    name: string,
    isActive = true,
  ) =>
    (
      await prisma.listing.create({
        data: {
          landlordId,
          type: 'EQUIPO',
          name,
          location: 'San Salvador',
          rateAmount: '10.00',
          rateUnit: 'DIA',
          isActive,
        },
      })
    ).id;

  /** Una reserva del bien con sus intentos de pago, en orden. */
  async function reservation(
    listingId: string,
    payments: {
      status?: 'APROBADO' | 'PENDIENTE' | 'RECHAZADO';
      rentalCost: string;
      depositAmount?: string;
      createdAt: Date;
    }[],
  ) {
    const { id: reservationId } = await prisma.reservation.create({
      data: {
        listingId,
        tenantId: ids.tenant,
        startAt: new Date('2026-12-10T15:00:00Z'),
        endAt: new Date('2026-12-12T15:00:00Z'),
        status: 'CONFIRMADA',
        rentalCost: payments[0].rentalCost,
        depositAmount: payments[0].depositAmount ?? '15.00',
      },
    });
    let attemptNumber = 0;
    for (const p of payments) {
      const status = p.status ?? 'APROBADO';
      const deposit = p.depositAmount ?? '15.00';
      await prisma.simulatedPayment.create({
        data: {
          reservationId,
          rentalCost: p.rentalCost,
          depositAmount: deposit,
          totalAmount: (Number(p.rentalCost) + Number(deposit)).toFixed(2),
          status,
          cardLast4: status === 'RECHAZADO' ? '0002' : '4242',
          rejectionReason:
            status === 'RECHAZADO' ? 'Tarjeta rechazada (prueba)' : null,
          attemptNumber: ++attemptNumber,
          createdAt: p.createdAt,
        },
      });
    }
  }

  const byName = (report: Report) =>
    Object.fromEntries(report.porBien.map((b) => [b.nombre, b.ingreso]));

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl();
    const { AppModule } = await import('../src/app.module.js');
    const { PrismaService } =
      await import('../src/prisma/services/prisma.service.js');
    const { Clock } = await import('../src/income/services/clock.js');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
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

    await createAccount('landlord', 'ARRENDADOR');
    await createAccount('otherLandlord', 'ARRENDADOR');
    await createAccount('tenant', 'ARRENDATARIO');

    listing.taladro = await createListing(ids.landlord, 'A Taladro');
    listing.carpa = await createListing(ids.landlord, 'B Carpa');
    listing.bordes = await createListing(ids.landlord, 'C Bordes');
    listing.antigua = await createListing(ids.landlord, 'D Antigua', false);
    listing.retirada = await createListing(ids.landlord, 'E Retirada', false);
    listing.ajena = await createListing(ids.otherLandlord, 'F Ajena');

    // A Taladro: 40.00 + 25.50 + 10.00 = 75.50 en noviembre.
    // El depósito (100.00) es mayor que el alquiler y no se suma.
    await reservation(listing.taladro, [
      {
        rentalCost: '40.00',
        depositAmount: '100.00',
        createdAt: sv(11, 5, 10),
      },
    ]);
    await reservation(listing.taladro, [
      { rentalCost: '25.50', createdAt: sv(11, 20, 10) },
    ]);
    // Dos rechazos y el aprobado final: solo cuenta el aprobado.
    await reservation(listing.taladro, [
      { status: 'RECHAZADO', rentalCost: '10.00', createdAt: sv(11, 10, 9) },
      { status: 'RECHAZADO', rentalCost: '10.00', createdAt: sv(11, 10, 9, 1) },
      { rentalCost: '10.00', createdAt: sv(11, 10, 9, 2) },
    ]);
    // PENDIENTE y RECHAZADO solos no cuentan.
    await reservation(listing.taladro, [
      { status: 'PENDIENTE', rentalCost: '99.00', createdAt: sv(11, 12) },
    ]);
    await reservation(listing.taladro, [
      { status: 'RECHAZADO', rentalCost: '77.00', createdAt: sv(11, 13) },
    ]);

    // C Bordes: un pago en cada borde. En noviembre cuentan 1.00 y 4.00.
    await reservation(listing.bordes, [
      // 31-oct 23:59:59.999 SV: fuera por 1 ms.
      { rentalCost: '2.00', createdAt: sv(10, 31, 23, 59, 59, 999) },
    ]);
    await reservation(listing.bordes, [
      // 1-nov 00:00:00 SV: primer instante de desde.
      { rentalCost: '1.00', createdAt: sv(11, 1) },
    ]);
    await reservation(listing.bordes, [
      // 30-nov 23:59:59 SV: último segundo de hasta.
      { rentalCost: '4.00', createdAt: sv(11, 30, 23, 59, 59) },
    ]);
    await reservation(listing.bordes, [
      // 1-dic 00:00:00 SV: ya es el día siguiente.
      { rentalCost: '8.00', createdAt: sv(12, 1) },
    ]);

    // D Antigua (desactivada) tuvo ingresos; E Retirada (desactivada), no.
    await reservation(listing.antigua, [
      { rentalCost: '12.00', createdAt: sv(11, 12) },
    ]);

    // Otro arrendador con pagos en el mismo período.
    await reservation(listing.ajena, [
      { rentalCost: '500.00', createdAt: sv(11, 15) },
    ]);
  }, 60_000);

  afterAll(async () => {
    const users = { email: { endsWith: suffix } };
    const listings = { listing: { landlord: users } };
    await prisma.simulatedPayment.deleteMany({
      where: { reservation: listings },
    });
    await prisma.reservation.deleteMany({ where: listings });
    await prisma.listing.deleteMany({ where: { landlord: users } });
    await prisma.user.deleteMany({ where: users });
    await app.close();
  });

  beforeEach(() => {
    now = sv(11, 16, 12);
  });

  it('suma por bien los pagos APROBADO del rango, sin depósito, y el total cuadra', async () => {
    const { body } = await get(NOVIEMBRE).expect(200);
    const report = body as Report;

    expect(report).toMatchObject({
      desde: '2026-11-01',
      hasta: '2026-11-30',
      moneda: 'USD',
      total: '92.50',
    });
    expect(report.porBien).toEqual([
      { publicacionId: listing.taladro, nombre: 'A Taladro', ingreso: '75.50' },
      { publicacionId: listing.carpa, nombre: 'B Carpa', ingreso: '0.00' },
      { publicacionId: listing.bordes, nombre: 'C Bordes', ingreso: '5.00' },
      { publicacionId: listing.antigua, nombre: 'D Antigua', ingreso: '12.00' },
    ]);
  });

  it('el total coincide con la suma de los pagos APROBADO en la base', async () => {
    const { body } = await get(NOVIEMBRE).expect(200);

    const agg = await prisma.simulatedPayment.aggregate({
      _sum: { rentalCost: true },
      where: {
        status: 'APROBADO',
        createdAt: { gte: sv(11, 1), lt: sv(12, 1) },
        reservation: { listing: { landlordId: ids.landlord } },
      },
    });
    expect((body as Report).total).toBe(agg._sum.rentalCost!.toFixed(2));
  });

  it('no muestra los bienes desactivados sin ingresos', async () => {
    const { body } = await get(NOVIEMBRE).expect(200);
    expect((body as Report).porBien.map((b) => b.publicacionId)).not.toContain(
      listing.retirada,
    );
  });

  it('cada arrendador ve solo sus bienes', async () => {
    const mine = (await get(NOVIEMBRE).expect(200)).body as Report;
    expect(mine.porBien.map((b) => b.publicacionId)).not.toContain(
      listing.ajena,
    );

    const other = (await get(NOVIEMBRE, 'otherLandlord').expect(200))
      .body as Report;
    expect(other).toMatchObject({
      total: '500.00',
      porBien: [
        { publicacionId: listing.ajena, nombre: 'F Ajena', ingreso: '500.00' },
      ],
    });
  });

  describe('bordes del rango (hora de El Salvador)', () => {
    it('hasta incluye el último segundo del día y excluye las 00:00 del siguiente', async () => {
      const nov30 = byName(
        (await get(`${URL_BASE}?desde=2026-11-30&hasta=2026-11-30`).expect(200))
          .body,
      );
      expect(nov30['C Bordes']).toBe('4.00');

      const dic1 = byName(
        (await get(`${URL_BASE}?desde=2026-12-01&hasta=2026-12-01`).expect(200))
          .body,
      );
      expect(dic1['C Bordes']).toBe('8.00');
    });

    it('desde incluye las 00:00 del día y excluye el último ms del anterior', async () => {
      const nov1 = byName(
        (await get(`${URL_BASE}?desde=2026-11-01&hasta=2026-11-01`).expect(200))
          .body,
      );
      expect(nov1['C Bordes']).toBe('1.00');

      const oct31 = byName(
        (await get(`${URL_BASE}?desde=2026-10-31&hasta=2026-10-31`).expect(200))
          .body,
      );
      expect(oct31['C Bordes']).toBe('2.00');
    });
  });

  describe('rango por defecto (mes en curso en El Salvador)', () => {
    it('sin fechas usa el mes en curso', async () => {
      const { body } = await get(URL_BASE).expect(200);
      expect(body).toMatchObject({
        desde: '2026-11-01',
        hasta: '2026-11-30',
        total: '92.50',
      });
    });

    it('el 1-dic a las 05:59:59Z todavía es noviembre en El Salvador', async () => {
      now = new Date('2026-12-01T05:59:59.000Z');
      const { body } = await get(URL_BASE).expect(200);
      expect(body).toMatchObject({
        desde: '2026-11-01',
        hasta: '2026-11-30',
        total: '92.50',
      });
    });

    it('el 1-dic a las 06:00Z ya es diciembre', async () => {
      now = new Date('2026-12-01T06:00:00.000Z');
      const report = (await get(URL_BASE).expect(200)).body as Report;
      expect(report).toMatchObject({
        desde: '2026-12-01',
        hasta: '2026-12-31',
        total: '8.00',
      });
      // D Antigua (desactivada) no tuvo ingresos en diciembre: no sale.
      expect(byName(report)).toEqual({
        'A Taladro': '0.00',
        'B Carpa': '0.00',
        'C Bordes': '8.00',
      });
    });

    it('solo desde: hasta es el último día del mes en curso', async () => {
      const report = (await get(`${URL_BASE}?desde=2026-11-20`).expect(200))
        .body as Report;
      expect(report).toMatchObject({
        desde: '2026-11-20',
        hasta: '2026-11-30',
        total: '29.50',
      });
    });

    it('solo hasta: desde es el primer día del mes en curso', async () => {
      const report = (await get(`${URL_BASE}?hasta=2026-11-05`).expect(200))
        .body as Report;
      expect(report).toMatchObject({
        desde: '2026-11-01',
        hasta: '2026-11-05',
        total: '41.00',
      });
    });
  });

  describe('400', () => {
    it.each([
      ['fecha inexistente', 'desde=2026-02-30&hasta=2026-03-01', 'no existe'],
      ['formato sin ceros', 'desde=2026-1-05&hasta=2026-01-31', 'AAAA-MM-DD'],
      ['formato dd/mm/aaaa', 'desde=01/11/2026&hasta=2026-11-30', 'AAAA-MM-DD'],
      [
        'desde posterior a hasta',
        'desde=2026-11-30&hasta=2026-11-01',
        'posterior',
      ],
      ['más de 366 días', 'desde=2026-01-01&hasta=2027-01-02', '366'],
      ['solo desde, posterior al fin del mes', 'desde=2026-12-05', 'posterior'],
      [
        'parámetro extra',
        'desde=2026-11-01&hasta=2026-11-30&arrendadorId=x',
        'arrendadorId',
      ],
    ])('%s', async (_caso, query, mensaje) => {
      const { body } = await get(`${URL_BASE}?${query}`).expect(400);
      expect(JSON.stringify(body.message)).toContain(mensaje);
    });

    it('acepta exactamente 366 días', async () => {
      await get(`${URL_BASE}?desde=2026-01-01&hasta=2027-01-01`).expect(200);
    });
  });

  it('401 sin sesión', async () => {
    await http().get(NOVIEMBRE).expect(401);
  });

  it('403 para un arrendatario', async () => {
    await get(NOVIEMBRE, 'tenant').expect(403);
  });
});
