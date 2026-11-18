import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from './helpers/test-database.js';

/**
 * Reporte de tasa de ocupación (BE-22.1, H22).
 *
 * Levanta la app completa contra la base de pruebas (local y terminada en
 * `_test`). Las reservas y los bloqueos se crean directo en la base: la
 * aprobación (BE-04.1) y el bloqueo de fechas (BE-14.1) todavía no están en
 * main. Fechas en UTC: El Salvador es UTC-6, así que la medianoche local del
 * día `d` de noviembre es `nov(d)`.
 */
const nov = (d: number, hour = 0) => new Date(Date.UTC(2026, 10, d, hour + 6));
const PERIODO = '/api/v1/reportes/ocupacion?desde=2026-11-01&hasta=2026-11-30';

describe('reporte de ocupación (BE-22.1)', () => {
  const email = `be-22.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let prisma: import('../src/prisma/services/prisma.service.js').PrismaService;
  let landlord: Session;
  let otherLandlord: Session;
  let tenant: Session;
  let accounts = 0;

  type Session = { token: string; userId: string };
  type Item = {
    publicacionId: string;
    nombre: string;
    diasOcupados: number;
    diasDisponibles: number;
    tasaOcupacion: number;
  };

  const http = () => request(app.getHttpServer());

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
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: address, password })
      .expect(200);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: address },
    });
    return { token: res.body.accessToken as string, userId: user.id };
  };

  const listing = async (name: string, owner: Session) =>
    (
      await prisma.listing.create({
        data: {
          landlordId: owner.userId,
          type: 'EQUIPO',
          name,
          location: 'San Salvador',
          rateAmount: '10.00',
          rateUnit: 'DIA',
        },
      })
    ).id;

  const reserve = (listingId: string, startAt: Date, endAt: Date) =>
    prisma.reservation.create({
      data: {
        listingId,
        tenantId: tenant.userId,
        startAt,
        endAt,
        status: 'CONFIRMADA',
        rentalCost: '10.00',
        depositAmount: '0.00',
      },
    });

  const report = (path: string, who: Session | null = landlord) => {
    const req = http().get(path);
    if (who) void req.set('Authorization', `Bearer ${who.token}`);
    return req;
  };

  const itemOf = (items: Item[], id: string) =>
    items.find((i) => i.publicacionId === id);

  let taladro: string;
  let sala: string;
  let sinReservas: string;
  let ajena: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl();
    const { AppModule } = await import('../src/app.module.js');
    const { PrismaService } =
      await import('../src/prisma/services/prisma.service.js');
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

    landlord = await account('ARRENDADOR');
    otherLandlord = await account('ARRENDADOR');
    tenant = await account('ARRENDATARIO');

    // Taladro: días 3-8 ocupados con dos reservas que se cruzan; 2 días bloqueados.
    taladro = await listing('Taladro', landlord);
    await reserve(taladro, nov(3, 10), nov(6, 10));
    await reserve(taladro, nov(5, 8), nov(8, 9));
    await prisma.availabilityBlock.create({
      data: { listingId: taladro, startAt: nov(20), endAt: nov(22) },
    });
    // Sala: todo el mes bloqueado.
    sala = await listing('Sala', landlord);
    await prisma.availabilityBlock.create({
      data: { listingId: sala, startAt: nov(1), endAt: nov(31) },
    });
    sinReservas = await listing('Proyector', landlord);
    ajena = await listing('Ajena', otherLandlord);
    await reserve(ajena, nov(1), nov(10));
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

  it('devuelve la tasa de cada bien con la fórmula del contrato', async () => {
    const { body } = await report(PERIODO).expect(200);

    expect(body.desde).toBe('2026-11-01');
    expect(body.hasta).toBe('2026-11-30');
    expect(itemOf(body.items, taladro)).toEqual({
      publicacionId: taladro,
      nombre: 'Taladro',
      diasOcupados: 6,
      diasDisponibles: 28,
      tasaOcupacion: 21.4,
    });
  });

  it('un bien sin reservas da 0 y uno sin días disponibles también', async () => {
    const { body } = await report(PERIODO).expect(200);

    expect(itemOf(body.items, sinReservas)).toMatchObject({
      diasOcupados: 0,
      diasDisponibles: 30,
      tasaOcupacion: 0,
    });
    expect(itemOf(body.items, sala)).toMatchObject({
      diasDisponibles: 0,
      tasaOcupacion: 0,
    });
  });

  it('cada arrendador recibe solo sus bienes', async () => {
    const mine = await report(PERIODO).expect(200);
    expect(mine.body.items.map((i: Item) => i.publicacionId).sort()).toEqual(
      [taladro, sala, sinReservas].sort(),
    );

    const theirs = await report(PERIODO, otherLandlord).expect(200);
    expect(theirs.body.items).toEqual([
      expect.objectContaining({ publicacionId: ajena, diasOcupados: 9 }),
    ]);
  });

  it('sin fechas usa el mes en curso', async () => {
    const { body } = await report('/api/v1/reportes/ocupacion').expect(200);
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/El_Salvador',
    }).format(new Date());
    expect(body.desde).toBe(`${today.slice(0, 7)}-01`);
    expect(body.hasta.slice(0, 7)).toBe(today.slice(0, 7));
    expect(body.items).toHaveLength(3);
  });

  it.each([
    ['formato inválido', 'desde=01-11-2026&hasta=2026-11-30', 'AAAA-MM-DD'],
    ['fecha inexistente', 'desde=2026-02-30&hasta=2026-03-10', 'no existe'],
    [
      'desde posterior a hasta',
      'desde=2026-11-30&hasta=2026-11-01',
      'posterior',
    ],
    ['más de 366 días', 'desde=2026-01-01&hasta=2027-01-02', '366'],
    ['un parámetro desconocido', 'desde=2026-11-01&mes=11', 'mes'],
  ])('responde 400 con %s', async (_, qs, message) => {
    const { body } = await report(`/api/v1/reportes/ocupacion?${qs}`).expect(
      400,
    );
    expect(JSON.stringify(body.message)).toContain(message);
  });

  it('acepta un rango de exactamente 366 días', async () => {
    await report(
      '/api/v1/reportes/ocupacion?desde=2028-01-01&hasta=2028-12-31',
    ).expect(200);
  });

  it('responde 403 al arrendatario y 401 sin sesión', async () => {
    await report(PERIODO, tenant).expect(403);
    await report(PERIODO, null).expect(401);
  });
});
