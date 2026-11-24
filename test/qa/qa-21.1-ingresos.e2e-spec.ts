import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module.js';
import { Prisma } from '@PrismaClient';
import { PrismaService } from '@Prisma/services';
import { Clock } from '@Income/services';
import { PASARELA_CONFIG, type PasarelaConfig } from '@Payments/services';
import { createTestPrismaClient } from '../helpers/test-database.js';

/**
 * QA-21.1 (MP4-118): cálculo y permisos del reporte de ingresos (H21).
 *
 * Los ids (C01 a C22) se repiten en docs/qa/QA-21.1-ingresos.md. Cada caso
 * llama a GET /api/v1/reportes/ingresos con el JWT de un login real y compara
 * con lo esperado según el contrato (docs/modulos/ingresos.md y la sección
 * DB-21.1 de docs/modulos/pagos.md).
 *
 * - Datos distintos a los de test/income.e2e-spec.ts: el "mes en curso" es
 *   marzo de 2027 (reloj fijado con overrideProvider(Clock)).
 * - Las reservas se crean directo en la base: en main no hay endpoint para
 *   crearlas. Los pagos de borde también, porque necesitan un created_at
 *   exacto. C22 hace el pago por la API real (pasarela con 0 ms de espera).
 * - El REVISOR solo lo crea el seed: aquí se crea en la base y su token se
 *   firma con el JwtService de la app.
 *
 * Los ids (C01 a C22) se repiten en docs/qa/QA-21.1-ingresos.md. Los casos que
 * prueban un criterio de aceptación de H21 empiezan con «ACn:» y conservan su
 * id al final, entre paréntesis.
 *
 * Corre contra la base `_test` (test/helpers/test-database.ts). Los correos
 * llevan un sufijo único por ejecución y en afterAll se borra solo lo creado.
 */
const prisma = createTestPrismaClient();
const pasarela: PasarelaConfig = { retardoMs: 0 };

/** Hora de El Salvador (UTC−6 fijo) como `Date` UTC. */
const sv = (y: number, m: number, d: number, h = 0, min = 0, s = 0, ms = 0) =>
  new Date(Date.UTC(y, m - 1, d, h + 6, min, s, ms));

const URL_BASE = '/api/v1/reportes/ingresos';
const MARZO = `${URL_BASE}?desde=2027-03-01&hasta=2027-03-31`;
const dia = (d: string) => `${URL_BASE}?desde=${d}&hasta=${d}`;
const IMPORTE = /^\d+\.\d{2}$/;

interface Reporte {
  desde: string;
  hasta: string;
  moneda: string;
  total: string;
  porBien: { publicacionId: string; nombre: string; ingreso: string }[];
}

type Quien = 'a' | 'b' | 'c' | 'd' | 'inquilino' | 'revisor';

describe('H21. Ver los ingresos del arrendador', () => {
  const sufijo = `qa-21.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  /** Reloj de la app; los casos que lo necesitan lo mueven. */
  let ahora = sv(2027, 3, 15, 12);
  const reloj = { now: () => ahora };

  const user = {} as Record<Quien, { id: string; token: string }>;
  const bien = {} as Record<
    'andamio' | 'bodega' | 'generador' | 'proyectorB' | 'carpaC',
    string
  >;

  const http = () => request(app.getHttpServer());
  const get = (url: string, quien: Quien = 'a') =>
    http().get(url).set('Authorization', `Bearer ${user[quien].token}`);
  const reporte = async (url: string, quien: Quien = 'a') =>
    (await get(url, quien).expect(200)).body as Reporte;
  const porNombre = (r: Reporte) =>
    Object.fromEntries(r.porBien.map((b) => [b.nombre, b.ingreso]));

  async function cuenta(quien: Quien, rol: 'ARRENDADOR' | 'ARRENDATARIO') {
    const email = `${quien}-${sufijo}`;
    const { body } = await http()
      .post('/api/v1/users')
      .send({ email, password, rol, nombre: quien, telefono: '70001234' })
      .expect(201);
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    user[quien] = { id: body.id, token: login.body.accessToken };
  }

  const publicacion = async (landlordId: string, name: string) =>
    (
      await prisma.listing.create({
        data: {
          landlordId,
          type: 'EQUIPO',
          name,
          location: 'Santa Ana',
          rateAmount: '15.00',
          rateUnit: 'DIA',
        },
      })
    ).id;

  const nuevaReserva = async (
    listingId: string,
    rentalCost: string,
    depositAmount: string,
  ) =>
    (
      await prisma.reservation.create({
        data: {
          listingId,
          tenantId: user.inquilino.id,
          startAt: new Date('2027-05-10T15:00:00Z'),
          endAt: new Date('2027-05-12T15:00:00Z'),
          status: 'CONFIRMADA',
          rentalCost,
          depositAmount,
        },
      })
    ).id;

  type Intento = {
    status: 'APROBADO' | 'PENDIENTE' | 'RECHAZADO';
    rentalCost: string;
    depositAmount?: string;
    createdAt: Date;
  };

  /** Una reserva del bien con sus intentos de pago, en orden. */
  async function reserva(listingId: string, intentos: Intento[]) {
    const deposito0 = intentos[0].depositAmount ?? '15.00';
    const reservationId = await nuevaReserva(
      listingId,
      intentos[0].rentalCost,
      deposito0,
    );
    let attemptNumber = 0;
    for (const i of intentos) {
      const rental = new Prisma.Decimal(i.rentalCost);
      const deposit = new Prisma.Decimal(i.depositAmount ?? '15.00');
      await prisma.simulatedPayment.create({
        data: {
          reservationId,
          rentalCost: rental,
          depositAmount: deposit,
          totalAmount: rental.plus(deposit),
          status: i.status,
          cardLast4: i.status === 'RECHAZADO' ? '0002' : '4242',
          rejectionReason:
            i.status === 'RECHAZADO'
              ? 'Tarjeta rechazada por la pasarela de prueba'
              : null,
          attemptNumber: ++attemptNumber,
          createdAt: i.createdAt,
        },
      });
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(Clock)
      .useValue(reloj)
      .overrideProvider(PASARELA_CONFIG)
      .useValue(pasarela)
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

    await cuenta('a', 'ARRENDADOR');
    await cuenta('b', 'ARRENDADOR');
    await cuenta('c', 'ARRENDADOR');
    await cuenta('d', 'ARRENDADOR');
    await cuenta('inquilino', 'ARRENDATARIO');

    // REVISOR: no se registra por la API (solo seed).
    const emailRevisor = `revisor-${sufijo}`;
    const revisor = await prisma.user.create({
      data: {
        email: emailRevisor,
        passwordHash: 'no-es-un-hash-real',
        role: 'REVISOR',
      },
    });
    user.revisor = {
      id: revisor.id,
      token: await app
        .get(JwtService)
        .signAsync({ sub: revisor.id, email: emailRevisor }),
    };

    bien.andamio = await publicacion(user.a.id, 'Andamio');
    bien.bodega = await publicacion(user.a.id, 'Bodega');
    bien.generador = await publicacion(user.a.id, 'Generador');
    bien.proyectorB = await publicacion(user.b.id, 'Proyector B');
    bien.carpaC = await publicacion(user.c.id, 'Carpa C');

    // Andamio, marzo: 35.25 + 50.00 = 85.25.
    // Depósito de 200.00, mayor que el alquiler: no cuenta.
    await reserva(bien.andamio, [
      {
        status: 'APROBADO',
        rentalCost: '35.25',
        depositAmount: '200.00',
        createdAt: sv(2027, 3, 10, 10),
      },
    ]);
    // Un rechazo y el aprobado final: solo cuenta el aprobado.
    await reserva(bien.andamio, [
      {
        status: 'RECHAZADO',
        rentalCost: '50.00',
        createdAt: sv(2027, 3, 12, 9),
      },
      {
        status: 'APROBADO',
        rentalCost: '50.00',
        createdAt: sv(2027, 3, 12, 9, 1),
      },
    ]);
    // PENDIENTE y RECHAZADO solos: no cuentan.
    await reserva(bien.andamio, [
      { status: 'PENDIENTE', rentalCost: '60.00', createdAt: sv(2027, 3, 14) },
    ]);
    await reserva(bien.andamio, [
      { status: 'RECHAZADO', rentalCost: '45.00', createdAt: sv(2027, 3, 20) },
    ]);
    // APROBADO de otro mes: último ms de febrero en El Salvador.
    await reserva(bien.andamio, [
      {
        status: 'APROBADO',
        rentalCost: '18.40',
        createdAt: sv(2027, 2, 28, 23, 59, 59, 999),
      },
    ]);

    // Generador: un pago a cada lado de cada frontera UTC de las 06:00Z.
    // Marzo: 0.05 + 12.35 = 12.40.
    await reserva(bien.generador, [
      {
        status: 'APROBADO',
        rentalCost: '0.05',
        createdAt: new Date('2027-03-01T06:00:00.000Z'), // 1-mar 00:00 SV
      },
    ]);
    await reserva(bien.generador, [
      {
        status: 'APROBADO',
        rentalCost: '0.10',
        createdAt: new Date('2027-03-01T05:59:59.999Z'), // 28-feb 23:59:59.999 SV
      },
    ]);
    await reserva(bien.generador, [
      {
        status: 'APROBADO',
        rentalCost: '12.35',
        createdAt: new Date('2027-04-01T05:59:59.999Z'), // 31-mar 23:59:59.999 SV
      },
    ]);
    await reserva(bien.generador, [
      {
        status: 'APROBADO',
        rentalCost: '7.00',
        createdAt: new Date('2027-04-01T06:00:00.000Z'), // 1-abr 00:00 SV
      },
    ]);

    // Bodega: sin pagos.

    // Arrendador B, mismo período.
    await reserva(bien.proyectorB, [
      { status: 'APROBADO', rentalCost: '300.00', createdAt: sv(2027, 3, 15) },
    ]);
  }, 60_000);

  afterAll(async () => {
    const usuarios = { email: { endsWith: sufijo } };
    const deSusBienes = { listing: { landlord: usuarios } };
    await prisma.simulatedPayment.deleteMany({
      where: { reservation: deSusBienes },
    });
    await prisma.reservation.deleteMany({ where: deSusBienes });
    await prisma.listing.deleteMany({ where: { landlord: usuarios } });
    await prisma.user.deleteMany({ where: usuarios });
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(() => {
    ahora = sv(2027, 3, 15, 12);
  });

  describe('cálculo', () => {
    it('AC3: sin fechas usa el mes en curso en El Salvador (marzo) con los importes esperados (C01)', async () => {
      const r = await reporte(URL_BASE);
      expect(r).toEqual({
        desde: '2027-03-01',
        hasta: '2027-03-31',
        moneda: 'USD',
        total: '97.65',
        porBien: [
          { publicacionId: bien.andamio, nombre: 'Andamio', ingreso: '85.25' },
          { publicacionId: bien.bodega, nombre: 'Bodega', ingreso: '0.00' },
          {
            publicacionId: bien.generador,
            nombre: 'Generador',
            ingreso: '12.40',
          },
        ],
      });
    });

    it('AC1: total y por bien con 2 decimales: total = suma de porBien = suma de rental_cost APROBADO en la base (C02)', async () => {
      const r = await reporte(MARZO);
      expect(r.total).toMatch(IMPORTE);
      for (const b of r.porBien) expect(b.ingreso).toMatch(IMPORTE);

      const suma = r.porBien.reduce(
        (s, b) => s.plus(b.ingreso),
        new Prisma.Decimal(0),
      );
      expect(suma.toFixed(2)).toBe(r.total);

      const agg = await prisma.simulatedPayment.aggregate({
        _sum: { rentalCost: true },
        where: {
          status: 'APROBADO',
          createdAt: { gte: sv(2027, 3, 1), lt: sv(2027, 4, 1) },
          reservation: { listing: { landlordId: user.a.id } },
        },
      });
      expect(agg._sum.rentalCost!.toFixed(2)).toBe(r.total);
    });

    it('AC2: el depósito no cuenta: total exacto 97.65 y distinto de la suma de total_amount (C03)', async () => {
      const r = await reporte(MARZO);
      expect(r.total).toBe('97.65');
      expect(porNombre(r).Andamio).toBe('85.25');

      const agg = await prisma.simulatedPayment.aggregate({
        _sum: { totalAmount: true, depositAmount: true },
        where: {
          status: 'APROBADO',
          createdAt: { gte: sv(2027, 3, 1), lt: sv(2027, 4, 1) },
          reservation: { listing: { landlordId: user.a.id } },
        },
      });
      // 35.25+200 + 50+15 + 0.05+15 + 12.35+15 = 342.65
      expect(agg._sum.totalAmount!.toFixed(2)).toBe('342.65');
      expect(r.total).not.toBe(agg._sum.totalAmount!.toFixed(2));
      expect(agg._sum.depositAmount!.toFixed(2)).toBe('245.00');
    });

    it('C04: PENDIENTE y RECHAZADO no cuentan; con rechazo previo solo cuenta el aprobado', async () => {
      // Si contaran: +60 (PENDIENTE) +45 (RECHAZADO) +50 (rechazo previo).
      const r = await reporte(dia('2027-03-12'));
      expect(porNombre(r).Andamio).toBe('50.00');
      expect(porNombre(await reporte(dia('2027-03-14'))).Andamio).toBe('0.00');
      expect(porNombre(await reporte(dia('2027-03-20'))).Andamio).toBe('0.00');
      expect(porNombre(await reporte(MARZO)).Andamio).toBe('85.25');
    });

    it('C05: un APROBADO de febrero no suma en marzo y sí en febrero', async () => {
      const feb = await reporte(
        `${URL_BASE}?desde=2027-02-01&hasta=2027-02-28`,
      );
      expect(feb).toMatchObject({ desde: '2027-02-01', hasta: '2027-02-28' });
      expect(porNombre(feb)).toEqual({
        Andamio: '18.40',
        Bodega: '0.00',
        Generador: '0.10',
      });
      expect(feb.total).toBe('18.50');
      expect(porNombre(await reporte(MARZO)).Andamio).toBe('85.25');
    });

    it('C06: frontera de inicio: 06:00Z del 1-mar cuenta el 1-mar; 05:59:59.999Z es del 28-feb', async () => {
      expect(porNombre(await reporte(dia('2027-03-01')))).toEqual({
        Andamio: '0.00',
        Bodega: '0.00',
        Generador: '0.05',
      });
      expect(porNombre(await reporte(dia('2027-02-28')))).toEqual({
        Andamio: '18.40',
        Bodega: '0.00',
        Generador: '0.10',
      });
    });

    it('C07: frontera de fin: 23:59:59.999 SV del 31-mar cuenta; 06:00Z del 1-abr es de abril', async () => {
      expect(porNombre(await reporte(dia('2027-03-31'))).Generador).toBe(
        '12.35',
      );
      const abr1 = await reporte(dia('2027-04-01'));
      expect(porNombre(abr1).Generador).toBe('7.00');
      expect(abr1.total).toBe('7.00');
    });

    it('AC3: un rango propio inclusivo que cruza meses (28-feb a 1-abr) suma todo (C08)', async () => {
      const r = await reporte(`${URL_BASE}?desde=2027-02-28&hasta=2027-04-01`);
      expect(r).toMatchObject({
        desde: '2027-02-28',
        hasta: '2027-04-01',
        total: '123.15',
      });
      expect(porNombre(r)).toEqual({
        Andamio: '103.65', // 35.25 + 50.00 + 18.40
        Bodega: '0.00',
        Generador: '19.50', // 0.10 + 0.05 + 12.35 + 7.00
      });
    });

    it('C09: mes por defecto en la frontera: 1-abr 05:59:59.999Z es marzo; 06:00Z es abril', async () => {
      ahora = new Date('2027-04-01T05:59:59.999Z');
      expect(await reporte(URL_BASE)).toMatchObject({
        desde: '2027-03-01',
        hasta: '2027-03-31',
        total: '97.65',
      });

      ahora = new Date('2027-04-01T06:00:00.000Z');
      const abril = await reporte(URL_BASE);
      expect(abril).toMatchObject({
        desde: '2027-04-01',
        hasta: '2027-04-30',
        total: '7.00',
      });
      expect(porNombre(abril)).toEqual({
        Andamio: '0.00',
        Bodega: '0.00',
        Generador: '7.00',
      });
    });

    it('AC4: un bien sin ingresos aparece con 0.00 junto a dos bienes con pagos (C10)', async () => {
      const r = await reporte(MARZO);
      expect(r.porBien).toHaveLength(3);
      expect(r.porBien.find((b) => b.publicacionId === bien.bodega)).toEqual({
        publicacionId: bien.bodega,
        nombre: 'Bodega',
        ingreso: '0.00',
      });
      expect(porNombre(r)).toMatchObject({
        Andamio: '85.25',
        Generador: '12.40',
      });
    });
  });

  describe('aislamiento entre arrendadores', () => {
    it('AC5: un arrendador solo ve sus bienes y ningún dato de otro arrendador (C11)', async () => {
      const r = await reporte(MARZO);
      expect(Object.keys(r).sort()).toEqual(
        ['desde', 'hasta', 'moneda', 'porBien', 'total'].sort(),
      );
      for (const b of r.porBien) {
        expect(Object.keys(b).sort()).toEqual(
          ['ingreso', 'nombre', 'publicacionId'].sort(),
        );
      }

      const deA = await prisma.listing.findMany({
        where: { landlordId: user.a.id },
        select: { id: true },
      });
      expect(r.porBien.map((b) => b.publicacionId).sort()).toEqual(
        deA.map((l) => l.id).sort(),
      );

      const texto = JSON.stringify(r);
      for (const ajeno of [
        bien.proyectorB,
        bien.carpaC,
        user.b.id,
        user.c.id,
      ]) {
        expect(texto).not.toContain(ajeno);
      }
      expect(texto).not.toContain('Proyector B');
      expect(texto).not.toContain('300.00');

      const deB = await reporte(MARZO, 'b');
      expect(deB).toMatchObject({
        total: '300.00',
        porBien: [
          {
            publicacionId: bien.proyectorB,
            nombre: 'Proyector B',
            ingreso: '300.00',
          },
        ],
      });
      const textoB = JSON.stringify(deB);
      for (const ajeno of [
        bien.andamio,
        bien.bodega,
        bien.generador,
        user.a.id,
      ]) {
        expect(textoB).not.toContain(ajeno);
      }
    });

    it('C12: no se puede pedir el reporte de otro arrendador por parámetro (400)', async () => {
      for (const extra of [
        `arrendadorId=${user.b.id}`,
        `landlordId=${user.b.id}`,
        `publicacionId=${bien.proyectorB}`,
      ]) {
        const { body } = await get(`${MARZO}&${extra}`).expect(400);
        expect(JSON.stringify(body.message)).toContain(extra.split('=')[0]);
      }
    });
  });

  describe('rango inválido (400)', () => {
    const espera400 = async (query: string, mensaje: string) => {
      const { body } = await get(`${URL_BASE}?${query}`).expect(400);
      expect(JSON.stringify(body.message)).toContain(mensaje);
    };

    it('C13: desde posterior a hasta', async () => {
      await espera400('desde=2027-03-31&hasta=2027-03-01', 'posterior');
    });

    it.each([
      ['barras', 'desde=2027/03/01&hasta=2027-03-31'],
      ['año de dos dígitos', 'desde=2027-03-01&hasta=27-03-31'],
      ['sin ceros', 'desde=2027-3-1&hasta=2027-03-31'],
      ['texto', 'desde=hoy&hasta=2027-03-31'],
    ])('C14: formato inválido (%s)', async (_caso, query) => {
      await espera400(query, 'AAAA-MM-DD');
    });

    it.each([
      ['29-feb en año no bisiesto', 'desde=2027-02-29&hasta=2027-03-31'],
      ['31 de abril', 'desde=2027-04-01&hasta=2027-04-31'],
    ])('C15: fecha inexistente (%s)', async (_caso, query) => {
      await espera400(query, 'no existe');
    });

    it('C16: 366 días con el 29-feb-2028 se aceptan; 367, no', async () => {
      const r = await reporte(`${URL_BASE}?desde=2027-03-01&hasta=2028-02-29`);
      expect(r.total).toBe('104.65'); // marzo (97.65) + el 7.00 de abril
      await espera400('desde=2027-03-01&hasta=2028-03-01', '366');
    });

    it('C17: una sola fecha que queda fuera del mes en curso', async () => {
      // Solo desde (2-abr): hasta se completa con 31-mar.
      await espera400('desde=2027-04-02', 'posterior');
      // Solo hasta (27-feb): desde se completa con 1-mar.
      await espera400('hasta=2027-02-27', 'posterior');
    });
  });

  describe('permisos', () => {
    it('C18: sin sesión o con token inválido, 401', async () => {
      await http().get(MARZO).expect(401);
      await http()
        .get(MARZO)
        .set('Authorization', 'Bearer no-es-un-jwt')
        .expect(401);
    });

    it('AC6: un arrendatario no tiene acceso: 403 (C19)', async () => {
      await get(MARZO, 'inquilino').expect(403);
    });

    it('C20: un REVISOR recibe 403', async () => {
      await get(MARZO, 'revisor').expect(403);
    });

    it('C21: tras cambiar el rol a ARRENDATARIO, el mismo token recibe 403', async () => {
      await get(MARZO, 'd').expect(200);
      await prisma.user.update({
        where: { id: user.d.id },
        data: { role: 'ARRENDATARIO' },
      });
      await get(MARZO, 'd').expect(403);
    });
  });

  describe('flujo real por la API', () => {
    it('C22: pago rechazado y luego aprobado por POST /pagos/simulados; el reporte suma solo el alquiler', async () => {
      // Depósito mayor que el alquiler, como en C03.
      const reservaId = await nuevaReserva(bien.carpaC, '40.10', '150.00');
      const pagar = (numeroTarjeta: string) =>
        http()
          .post(`/api/v1/reservas/${reservaId}/pagos/simulados`)
          .set('Authorization', `Bearer ${user.inquilino.token}`)
          .send({ numeroTarjeta, vencimiento: '12/29', cvv: '123' });

      expect((await pagar('4000000000000002').expect(201)).body.estado).toBe(
        'RECHAZADO',
      );
      expect((await pagar('4242424242424242').expect(201)).body.estado).toBe(
        'APROBADO',
      );

      // El pago tiene la hora real: se pide el día de hoy en El Salvador con
      // un día de margen a cada lado (C no tiene otros pagos).
      const diaSv = (offsetDias: number) =>
        new Date(Date.now() - 6 * 3_600_000 + offsetDias * 86_400_000)
          .toISOString()
          .slice(0, 10);
      const r = await reporte(
        `${URL_BASE}?desde=${diaSv(-1)}&hasta=${diaSv(1)}`,
        'c',
      );
      expect(r.total).toBe('40.10');
      expect(r.porBien).toEqual([
        { publicacionId: bien.carpaC, nombre: 'Carpa C', ingreso: '40.10' },
      ]);
    });
  });
});
