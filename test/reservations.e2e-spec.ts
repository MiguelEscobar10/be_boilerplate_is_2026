import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '@Prisma/services';
import type { RateUnit, ReservationStatus, UserRole } from '@PrismaClient';
import { createTestPrismaClient } from './helpers/test-database.js';

/**
 * Solicitud y consulta de reservas (BE-03.1) con la app completa contra la
 * base de pruebas (ver test/helpers/test-database.ts).
 *
 * Crea un arrendador, otro arrendador y dos arrendatarios con email único,
 * firma sus tokens con el JwtService de la app y al final borra solo lo que
 * creó. Las reservas ocupadas y los bloqueos se crean directo en la base.
 */
const prisma = createTestPrismaClient();

/** Hora local de El Salvador → instante. `local(10, 9)` = 10 de dic de 2030, 09:00. */
const local = (day: number, hour = 0) =>
  new Date(Date.UTC(2030, 11, day, hour + 6));
/** El mismo instante como lo escribe la API: `2030-12-10T09:00:00-06:00`. */
const iso = (day: number, hour = 0) =>
  `2030-12-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00-06:00`;

interface Cuenta {
  id: string;
  token: string;
}

describe('solicitud y consulta de reservas (BE-03.1)', () => {
  const sufijo = `be-03.1-${randomUUID()}@test.local`;
  let app: INestApplication;
  let arrendador: Cuenta;
  let otroArrendador: Cuenta;
  let ana: Cuenta;
  let bruno: Cuenta;

  const auth = (req: request.Test, cuenta: Cuenta | null) =>
    cuenta ? req.set('Authorization', `Bearer ${cuenta.token}`) : req;
  const solicitar = (
    body: Record<string, unknown>,
    cuenta: Cuenta | null = ana,
  ) =>
    auth(
      request(app.getHttpServer()).post('/api/v1/reservas').send(body),
      cuenta,
    );
  const detalle = (id: string, cuenta: Cuenta | null = ana) =>
    auth(request(app.getHttpServer()).get(`/api/v1/reservas/${id}`), cuenta);

  const newListing = async (
    extra: {
      rateAmount?: string;
      rateUnit?: RateUnit;
      depositAmount?: string;
      isActive?: boolean;
      requiresVerification?: boolean;
    } = {},
  ) =>
    (
      await prisma.listing.create({
        data: {
          landlordId: arrendador.id,
          type: 'EQUIPO',
          name: 'Taladro percutor',
          location: 'Santa Tecla',
          rateAmount: extra.rateAmount ?? '15.00',
          rateUnit: extra.rateUnit ?? 'HORA',
          depositAmount: extra.depositAmount ?? '20.00',
          isActive: extra.isActive ?? true,
          requiresVerification: extra.requiresVerification ?? false,
        },
      })
    ).id;

  const ocupar = (
    listingId: string,
    startAt: Date,
    endAt: Date,
    status: ReservationStatus,
  ) =>
    prisma.reservation.create({
      data: {
        listingId,
        tenantId: bruno.id,
        startAt,
        endAt,
        status,
        rentalCost: '10.00',
        depositAmount: '0.00',
      },
    });

  const contar = (listingId: string) =>
    prisma.reservation.count({ where: { listingId, tenantId: ana.id } });

  const valido = (listingId: string) => ({
    publicacionId: listingId,
    inicio: iso(10, 9),
    fin: iso(10, 12),
  });

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
    const crear = async (nombre: string, role: UserRole): Promise<Cuenta> => {
      const email = `${nombre}-${sufijo}`;
      const { id } = await prisma.user.create({
        data: { email, passwordHash: 'no-es-un-hash-real', role },
      });
      return { id, token: await jwt.signAsync({ sub: id, email }) };
    };
    arrendador = await crear('arrendador', 'ARRENDADOR');
    otroArrendador = await crear('otro', 'ARRENDADOR');
    ana = await crear('ana', 'ARRENDATARIO');
    bruno = await crear('bruno', 'ARRENDATARIO');
  });

  afterAll(async () => {
    // Primero las reservas (RESTRICT); los bloqueos y las verificaciones se
    // van con su publicación o su usuario.
    await prisma.reservation.deleteMany({
      where: { tenant: { email: { endsWith: sufijo } } },
    });
    await prisma.listing.deleteMany({
      where: { landlord: { email: { endsWith: sufijo } } },
    });
    // La verificación aprobada apunta a su revisor (RESTRICT): va antes que los usuarios.
    await prisma.identityVerification.deleteMany({
      where: { user: { email: { endsWith: sufijo } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: sufijo } } });
    await app.close();
    await prisma.$disconnect();
  });

  describe('POST /reservas', () => {
    it('201: guarda la solicitud PENDIENTE con el costo del servidor y el depósito aparte', async () => {
      const id = await newListing();

      const res = await solicitar(valido(id)).expect(201);

      expect(res.body).toMatchObject({
        id: expect.any(String) as string,
        estado: 'PENDIENTE',
        publicacion: { id, nombre: 'Taladro percutor' },
        inicio: '2030-12-10T09:00:00-06:00',
        fin: '2030-12-10T12:00:00-06:00',
        costoAlquiler: '45.00',
        depositoMonto: '20.00',
        decididaAt: null,
        motivoRechazo: null,
      });
      const guardada = await prisma.reservation.findUniqueOrThrow({
        where: { id: res.body.id as string },
      });
      expect(guardada).toMatchObject({
        listingId: id,
        tenantId: ana.id,
        status: 'PENDIENTE',
        startAt: local(10, 9),
        endAt: local(10, 12),
      });
      expect(guardada.rentalCost.toFixed(2)).toBe('45.00');
      expect(guardada.depositAmount.toFixed(2)).toBe('20.00');
    });

    it('ignora un monto que mande el cliente: 400 por campo no permitido', async () => {
      const id = await newListing();
      await solicitar({ ...valido(id), costoAlquiler: '1.00' }).expect(400);
      expect(await contar(id)).toBe(0);
    });

    it('calcula el costo por unidad de cobro y redondea la fracción hacia arriba', async () => {
      const casos: Array<[RateUnit, string, string, string, string]> = [
        // unidad, tarifa, inicio, fin, costo esperado
        ['HORA', '15.00', iso(11, 9), iso(11, 12), '45.00'],
        ['HORA', '15.00', iso(11, 9), '2030-12-11T11:10:00-06:00', '45.00'],
        ['DIA', '25.00', iso(11, 0), iso(13, 0), '50.00'],
        ['DIA', '25.00', iso(11, 0), iso(13, 1), '75.00'],
        ['NOCHE', '30.00', iso(11, 14), iso(13, 10), '60.00'],
        ['SEMANA', '100.00', iso(11, 0), iso(18, 0), '100.00'],
        ['SEMANA', '100.00', iso(11, 0), iso(18, 1), '200.00'],
        ['HORA', '15.10', iso(11, 9), iso(11, 12), '45.30'],
      ];
      for (const [rateUnit, rateAmount, inicio, fin, esperado] of casos) {
        const id = await newListing({ rateUnit, rateAmount });
        const res = await solicitar({ publicacionId: id, inicio, fin }).expect(
          201,
        );
        expect(
          [rateUnit, res.body.costoAlquiler],
          `${rateUnit} ${rateAmount} ${inicio}→${fin}`,
        ).toEqual([rateUnit, esperado]);
      }
    });

    it('una solicitud PENDIENTE no aparta fechas: otra persona puede pedir las mismas', async () => {
      const id = await newListing();
      await solicitar(valido(id), ana).expect(201);
      await solicitar(valido(id), bruno).expect(201);
    });

    it('avisa al arrendador con el título, el bien, las fechas y la referencia a la reserva', async () => {
      const id = await newListing();
      const res = await solicitar(valido(id)).expect(201);

      const avisos = await prisma.notification.findMany({
        where: { userId: arrendador.id, referenceId: res.body.id as string },
      });
      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toMatchObject({
        sourceModule: 'RESERVAS',
        title: 'Nueva solicitud de reserva',
        referenceType: 'reserva',
        readAt: null,
      });
      expect(avisos[0].message).toContain('Taladro percutor');
      expect(avisos[0].message).toContain('10/12/2030 09:00');
      expect(avisos[0].message).toContain('10/12/2030 12:00');
    });

    it('400: fin anterior o igual al inicio', async () => {
      const id = await newListing();
      await solicitar({ ...valido(id), fin: iso(10, 8) }).expect(400);
      await solicitar({ ...valido(id), fin: iso(10, 9) }).expect(400);
      expect(await contar(id)).toBe(0);
    });

    it('400 FECHA_PASADA: el inicio ya pasó, y no se guarda', async () => {
      const id = await newListing();
      const res = await solicitar({
        publicacionId: id,
        inicio: '2020-01-10T09:00:00-06:00',
        fin: '2020-01-10T12:00:00-06:00',
      }).expect(400);
      expect(res.body).toMatchObject({ codigo: 'FECHA_PASADA' });
      expect(await contar(id)).toBe(0);
    });

    it('400: fechas sin zona, mal escritas o que no existen', async () => {
      const id = await newListing();
      for (const inicio of [
        '2030-12-10T09:00:00',
        '2030-12-10',
        'mañana',
        '2030-02-30T09:00:00-06:00',
      ]) {
        await solicitar({ ...valido(id), inicio }).expect(400);
      }
      await solicitar({ publicacionId: id, inicio: iso(10, 9) }).expect(400);
      expect(await contar(id)).toBe(0);
    });

    it('400: publicacionId que no es UUID', async () => {
      await solicitar({ ...valido('17'), publicacionId: '17' }).expect(400);
    });

    it('404: publicación que no existe', async () => {
      await solicitar(valido(randomUUID())).expect(404);
    });

    it('404: publicación desactivada', async () => {
      const id = await newListing({ isActive: false });
      await solicitar(valido(id)).expect(404);
      expect(await contar(id)).toBe(0);
    });

    it('409: choca con una reserva CONFIRMADA', async () => {
      const id = await newListing();
      await ocupar(id, local(10, 10), local(10, 14), 'CONFIRMADA');
      const res = await solicitar(valido(id)).expect(409);
      expect(res.body).toMatchObject({ codigo: 'PERIODO_NO_DISPONIBLE' });
      expect(await contar(id)).toBe(0);
    });

    it('409: choca con una reserva EN_CURSO', async () => {
      const id = await newListing();
      await ocupar(id, local(10, 6), local(10, 10), 'EN_CURSO');
      await solicitar(valido(id)).expect(409);
    });

    it('409: choca con un bloqueo del arrendador, sin revelar su motivo', async () => {
      const id = await newListing();
      await prisma.availabilityBlock.create({
        data: {
          listingId: id,
          createdById: arrendador.id,
          startAt: local(10, 0),
          endAt: local(11, 0),
          reason: 'Vacaciones privadas',
        },
      });
      const res = await solicitar(valido(id)).expect(409);
      expect(JSON.stringify(res.body)).not.toContain('Vacaciones');
    });

    it('tocar el borde de una reserva o de un bloqueo no es un choque', async () => {
      const id = await newListing();
      await ocupar(id, local(10, 6), local(10, 9), 'CONFIRMADA');
      await prisma.availabilityBlock.create({
        data: {
          listingId: id,
          createdById: arrendador.id,
          startAt: local(10, 12),
          endAt: local(10, 15),
        },
      });
      await solicitar(valido(id)).expect(201);
    });

    it('solo CONFIRMADA y EN_CURSO ocupan: PENDIENTE, RECHAZADA, CANCELADA y COMPLETADA no', async () => {
      const id = await newListing();
      for (const status of [
        'PENDIENTE',
        'RECHAZADA',
        'CANCELADA',
        'COMPLETADA',
      ] as const) {
        await ocupar(id, local(10, 9), local(10, 12), status);
      }
      await solicitar(valido(id)).expect(201);
    });

    it('422 VERIFICACION_REQUERIDA: la publicación la exige y el arrendatario no está verificado', async () => {
      const id = await newListing({ requiresVerification: true });
      const res = await solicitar(valido(id)).expect(422);
      expect(res.body).toMatchObject({ codigo: 'VERIFICACION_REQUERIDA' });
      expect(await contar(id)).toBe(0);
    });

    it('422: una verificación PENDIENTE no alcanza', async () => {
      const id = await newListing({ requiresVerification: true });
      await prisma.identityVerification.create({
        data: {
          userId: ana.id,
          documentKey: 'v/pendiente.pdf',
          status: 'PENDIENTE',
        },
      });
      await solicitar(valido(id)).expect(422);
    });

    it('201: con la verificación APROBADA se registra', async () => {
      const id = await newListing({ requiresVerification: true });
      await prisma.identityVerification.create({
        data: {
          userId: bruno.id,
          documentKey: 'v/aprobada.pdf',
          status: 'APROBADA',
          submittedAt: new Date('2030-01-01T00:00:00Z'),
          reviewedById: otroArrendador.id,
          reviewedAt: new Date('2030-01-02T00:00:00Z'),
        },
      });
      await solicitar(valido(id), bruno).expect(201);
    });

    it('la verificación solo se exige si la publicación la pide', async () => {
      const id = await newListing({ requiresVerification: false });
      await solicitar(valido(id)).expect(201);
    });

    it('401 sin sesión y 403 con un rol que no es arrendatario', async () => {
      const id = await newListing();
      await solicitar(valido(id), null).expect(401);
      await solicitar(valido(id), arrendador).expect(403);
      expect(await contar(id)).toBe(0);
    });
  });

  describe('GET /reservas/:id', () => {
    it('200: el arrendatario ve fechas, estado, costo y depósito aparte', async () => {
      const id = await newListing();
      const creada = await solicitar(valido(id)).expect(201);

      const res = await detalle(creada.body.id as string).expect(200);

      expect(res.body).toMatchObject({
        id: creada.body.id,
        estado: 'PENDIENTE',
        inicio: '2030-12-10T09:00:00-06:00',
        fin: '2030-12-10T12:00:00-06:00',
        costoAlquiler: '45.00',
        depositoMonto: '20.00',
      });
    });

    it('200: el dueño de la publicación también la ve', async () => {
      const id = await newListing();
      const creada = await solicitar(valido(id)).expect(201);
      await detalle(creada.body.id as string, arrendador).expect(200);
    });

    it('conserva el precio de la fotografía aunque la tarifa cambie después', async () => {
      const id = await newListing();
      const creada = await solicitar(valido(id)).expect(201);
      await prisma.listing.update({
        where: { id },
        data: { rateAmount: '99.00', depositAmount: '50.00' },
      });
      const res = await detalle(creada.body.id as string).expect(200);
      expect(res.body).toMatchObject({
        costoAlquiler: '45.00',
        depositoMonto: '20.00',
      });
    });

    it('el arrendatario ve el motivo si la rechazaron', async () => {
      const id = await newListing();
      const creada = await solicitar(valido(id)).expect(201);
      await prisma.reservation.update({
        where: { id: creada.body.id as string },
        data: {
          status: 'RECHAZADA',
          decidedAt: new Date(),
          decidedById: arrendador.id,
          rejectionReason: 'No está disponible ese día',
        },
      });
      const res = await detalle(creada.body.id as string).expect(200);
      expect(res.body).toMatchObject({
        estado: 'RECHAZADA',
        motivoRechazo: 'No está disponible ese día',
      });
    });

    it('404: una reserva ajena, igual que una que no existe', async () => {
      const id = await newListing();
      const creada = await solicitar(valido(id)).expect(201);
      const ajena = await detalle(creada.body.id as string, bruno).expect(404);
      const inexistente = await detalle(randomUUID(), bruno).expect(404);
      expect(ajena.body.message).toBe(inexistente.body.message);
      // Ni siquiera el arrendador de otra publicación.
      await detalle(creada.body.id as string, otroArrendador).expect(404);
    });

    it('400: el id no es un UUID', async () => {
      await detalle('91').expect(400);
    });

    it('401 sin sesión', async () => {
      const id = await newListing();
      const creada = await solicitar(valido(id)).expect(201);
      await detalle(creada.body.id as string, null).expect(401);
    });
  });
});
