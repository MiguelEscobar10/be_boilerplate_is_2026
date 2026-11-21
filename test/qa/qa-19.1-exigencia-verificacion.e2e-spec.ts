import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';

/**
 * QA-19.1 (MP4-105): plan de pruebas de la exigencia de verificación de
 * identidad para reservar (H19).
 *
 * Cada caso tiene un id (E01, E02...) que se repite en la evidencia de
 * docs/qa/QA-19.1-exigencia-verificacion.md.
 *
 * QA-03.1 (S20-S22, Mario) ya prueba el camino corto del 422: sin
 * verificación o con una PENDIENTE no se guarda, con una APROBADA sí, y la
 * verificación se revisa antes que la disponibilidad. Este plan no repite
 * eso: cubre la opción misma (PATCH de BE-19.1 y sus permisos), qué cuenta
 * como "verificado", el alcance por publicación, el momento en que el cambio
 * surte efecto, la precedencia frente a los otros errores y qué deja (o no
 * deja) el 422 en la base.
 */

const DIA = 24 * 60 * 60 * 1000;
const HORA = 60 * 60 * 1000;

type Session = { token: string; userId: string };

describe('QA-19.1: exigencia de verificación para reservar', () => {
  const email = `qa-19.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let prisma: import('../../src/prisma/services/prisma.service.js').PrismaService;
  let dueno: Session;
  let otroDueno: Session;
  let sinVerificar: Session;
  let verificado: Session;
  let cuentas = 0;
  // Cada caso usa días distintos (a partir de 2032) para no cruzarse.
  let siguienteDia = 0;

  const http = () => request(app.getHttpServer());
  const auth = (req: request.Test, who: Session | null) =>
    who ? req.set('Authorization', `Bearer ${who.token}`) : req;

  const cuenta = async (rol: 'ARRENDATARIO' | 'ARRENDADOR', nombre: string) => {
    const address = `${rol.toLowerCase()}${++cuentas}-${email}`;
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

  /** Publicación del dueño, con la opción apagada salvo que se pida. */
  const publicacion = async (
    exige = false,
    owner = dueno,
    extra: { isActive?: boolean } = {},
  ) =>
    (
      await prisma.listing.create({
        data: {
          landlordId: owner.userId,
          type: 'EQUIPO',
          name: 'Proyector Epson',
          description: 'Incluye cables',
          location: 'Antiguo Cuscatlán',
          rateAmount: '15.00',
          rateUnit: 'HORA',
          depositAmount: '20.00',
          conditions: 'Devolver con la bolsa',
          isActive: extra.isActive ?? true,
          requiresVerification: exige,
        },
      })
    ).id;

  /** Una verificación con el estado que pida el caso (DB-07.1). */
  const verificacion = (
    who: Session,
    status: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA',
  ) =>
    prisma.identityVerification.create({
      data: {
        userId: who.userId,
        documentKey: `v/${status.toLowerCase()}-${randomUUID()}.pdf`,
        status,
        // La base exige revisor y fecha juntos, y solo si ya se decidió.
        ...(status === 'PENDIENTE'
          ? {}
          : {
              reviewedById: dueno.userId,
              reviewedAt: new Date('2031-01-02T00:00:00Z'),
            }),
        ...(status === 'RECHAZADA' ? { rejectionReason: 'Foto borrosa' } : {}),
      },
    });

  /** Un día libre nuevo, a las 00:00 de El Salvador. */
  const dia = () => new Date(Date.UTC(2032, 0, 1) + 6 * HORA + siguienteDia++ * DIA);
  const iso = (d: Date) =>
    `${new Date(d.getTime() - 6 * HORA).toISOString().slice(0, 19)}-06:00`;
  const aLas = (d: Date, horas: number) => new Date(d.getTime() + horas * HORA);

  const pedir = (
    publicacionId: string,
    desde: Date,
    hasta: Date,
    who: Session | null = sinVerificar,
  ) =>
    auth(
      http()
        .post('/api/v1/reservas')
        .send({ publicacionId, inicio: iso(desde), fin: iso(hasta) }),
      who,
    );

  const cambiar = (
    publicacionId: string,
    cuerpo: Record<string, unknown>,
    who: Session | null = dueno,
  ) =>
    auth(
      http()
        .patch(`/api/v1/publicaciones/${publicacionId}/requiere-verificacion`)
        .send(cuerpo),
      who,
    );

  const exigeEnLaBase = async (id: string) =>
    (
      await prisma.listing.findUniqueOrThrow({
        where: { id },
        select: { requiresVerification: true },
      })
    ).requiresVerification;

  const reservasDe = (publicacionId: string) =>
    prisma.reservation.count({ where: { listingId: publicacionId } });

  const avisosDe = (who: Session) =>
    prisma.notification.count({ where: { userId: who.userId } });

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl();
    const { AppModule } = await import('../../src/app.module.js');
    const { PrismaService } = await import(
      '../../src/prisma/services/prisma.service.js'
    );
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

    dueno = await cuenta('ARRENDADOR', 'Rita Dueña');
    otroDueno = await cuenta('ARRENDADOR', 'Otro Dueño');
    sinVerificar = await cuenta('ARRENDATARIO', 'Ana Sin Verificar');
    verificado = await cuenta('ARRENDATARIO', 'Beto Verificado');
    await verificacion(verificado, 'APROBADA');
  });

  // Cada caso borra sus publicaciones al terminar: los archivos de prueba
  // corren en paralelo sobre la misma base y dejar filas de más le cambia el
  // plan de consulta a otras suites (listings.detail.constraints).
  afterEach(async () => {
    await prisma.notification.deleteMany({
      where: { user: { email: { endsWith: email } } },
    });
    await prisma.reservation.deleteMany({
      where: { listing: { landlord: { email: { endsWith: email } } } },
    });
    await prisma.listing.deleteMany({
      where: { landlord: { email: { endsWith: email } } },
    });
  });

  afterAll(async () => {
    const usuarios = { user: { email: { endsWith: email } } };
    await prisma.notification.deleteMany({ where: usuarios });
    await prisma.reservation.deleteMany({
      where: { listing: { landlord: { email: { endsWith: email } } } },
    });
    await prisma.identityVerification.deleteMany({ where: usuarios });
    await prisma.listing.deleteMany({
      where: { landlord: { email: { endsWith: email } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await app.close();
  });

  describe('la opción de la publicación (BE-19.1)', () => {
    it('E01: el dueño la activa y la desactiva, y la respuesta trae el valor guardado', async () => {
      const id = await publicacion();

      const encendida = await cambiar(id, { requiereVerificacion: true }).expect(200);
      expect(encendida.body).toEqual({ id, requiereVerificacion: true });
      expect(await exigeEnLaBase(id)).toBe(true);

      const apagada = await cambiar(id, { requiereVerificacion: false }).expect(200);
      expect(apagada.body).toEqual({ id, requiereVerificacion: false });
      expect(await exigeEnLaBase(id)).toBe(false);
    });

    it('E02: repetir el mismo valor responde igual y no cambia nada', async () => {
      const id = await publicacion(true);

      await cambiar(id, { requiereVerificacion: true }).expect(200);
      const otra = await cambiar(id, { requiereVerificacion: true }).expect(200);

      expect(otra.body).toEqual({ id, requiereVerificacion: true });
      expect(await exigeEnLaBase(id)).toBe(true);
    });

    it('E03: otro arrendador no la puede cambiar (403) y el valor queda igual', async () => {
      const id = await publicacion(false);

      const res = await cambiar(id, { requiereVerificacion: true }, otroDueno).expect(403);

      expect(res.body.message).toContain('dueño');
      expect(await exigeEnLaBase(id)).toBe(false);
    });

    it('E04: un arrendatario no la puede cambiar (403)', async () => {
      const id = await publicacion(false);

      await cambiar(id, { requiereVerificacion: true }, sinVerificar).expect(403);

      expect(await exigeEnLaBase(id)).toBe(false);
    });

    it('E05: sin sesión responde 401', async () => {
      const id = await publicacion(false);

      await cambiar(id, { requiereVerificacion: true }, null).expect(401);

      expect(await exigeEnLaBase(id)).toBe(false);
    });

    it('E06: publicación inexistente da 404 y un id que no es UUID da 400', async () => {
      await cambiar(randomUUID(), { requiereVerificacion: true }).expect(404);
      await cambiar('no-es-uuid', { requiereVerificacion: true }).expect(400);
    });

    it('E07: el cuerpo tiene que traer el campo y ser booleano', async () => {
      const id = await publicacion(false);

      const vacio = await cambiar(id, {}).expect(400);
      expect(String(vacio.body.message)).toContain('obligatorio');
      const texto = await cambiar(id, { requiereVerificacion: 'si' }).expect(400);
      expect(String(texto.body.message)).toContain('true o false');
      await cambiar(id, { requiereVerificacion: true, otroCampo: 1 }).expect(400);

      expect(await exigeEnLaBase(id)).toBe(false);
    });

    it('E08: cambiarla no toca el resto de la publicación', async () => {
      const id = await publicacion(false);
      const antes = await prisma.listing.findUniqueOrThrow({ where: { id } });

      await cambiar(id, { requiereVerificacion: true }).expect(200);

      const despues = await prisma.listing.findUniqueOrThrow({ where: { id } });
      expect({ ...despues, requiresVerification: false }).toEqual(antes);
    });
  });

  describe('qué cuenta como verificado', () => {
    it('E09: sin ninguna verificación, el 422 trae el código y el motivo', async () => {
      const id = await publicacion(true);
      const d = dia();

      const res = await pedir(id, aLas(d, 9), aLas(d, 12)).expect(422);

      expect(res.body).toMatchObject({
        statusCode: 422,
        error: 'Unprocessable Entity',
        codigo: 'VERIFICACION_REQUERIDA',
      });
      expect(String(res.body.message)).not.toHaveLength(0);
    });

    it('E10: una verificación RECHAZADA no alcanza (422)', async () => {
      const rechazado = await cuenta('ARRENDATARIO', 'Carla Rechazada');
      await verificacion(rechazado, 'RECHAZADA');
      const id = await publicacion(true);
      const d = dia();

      const res = await pedir(id, aLas(d, 9), aLas(d, 12), rechazado).expect(422);

      expect(res.body).toMatchObject({ codigo: 'VERIFICACION_REQUERIDA' });
      expect(await reservasDe(id)).toBe(0);
    });

    it('E11: tras una RECHAZADA, la APROBADA del segundo envío sí deja reservar', async () => {
      const persona = await cuenta('ARRENDATARIO', 'Dora Reenvía');
      await verificacion(persona, 'RECHAZADA');
      const id = await publicacion(true);
      const d = dia();
      await pedir(id, aLas(d, 9), aLas(d, 12), persona).expect(422);

      await verificacion(persona, 'APROBADA');
      await pedir(id, aLas(d, 9), aLas(d, 12), persona).expect(201);

      expect(await reservasDe(id)).toBe(1);
    });

    it('E12: la verificación aprobada de otra persona no sirve', async () => {
      const id = await publicacion(true);
      const d = dia();

      await pedir(id, aLas(d, 9), aLas(d, 12), sinVerificar).expect(422);
      await pedir(id, aLas(d, 9), aLas(d, 12), verificado).expect(201);
    });

    it('E13: con la verificación aprobada la solicitud queda PENDIENTE, como cualquier otra', async () => {
      const id = await publicacion(true);
      const d = dia();

      const res = await pedir(id, aLas(d, 9), aLas(d, 12), verificado).expect(201);

      expect(res.body).toMatchObject({ estado: 'PENDIENTE' });
    });
  });

  describe('alcance y momento del cambio', () => {
    it('E14: la opción es de cada publicación, no del dueño ni de la persona', async () => {
      const exige = await publicacion(true);
      const libre = await publicacion(false);
      const d = dia();

      await pedir(exige, aLas(d, 9), aLas(d, 12)).expect(422);
      await pedir(libre, aLas(d, 9), aLas(d, 12)).expect(201);
    });

    it('E15: activarla bloquea la siguiente solicitud', async () => {
      const id = await publicacion(false);
      const primero = dia();
      await pedir(id, aLas(primero, 9), aLas(primero, 12)).expect(201);

      await cambiar(id, { requiereVerificacion: true }).expect(200);

      const segundo = dia();
      await pedir(id, aLas(segundo, 9), aLas(segundo, 12)).expect(422);
      expect(await reservasDe(id)).toBe(1);
    });

    it('E16: apagarla vuelve a dejar solicitar', async () => {
      const id = await publicacion(true);
      const d = dia();
      await pedir(id, aLas(d, 9), aLas(d, 12)).expect(422);

      await cambiar(id, { requiereVerificacion: false }).expect(200);

      await pedir(id, aLas(d, 9), aLas(d, 12)).expect(201);
    });

    it('E17: activarla no toca las reservas ya registradas', async () => {
      const id = await publicacion(false);
      const d = dia();
      const creada = await pedir(id, aLas(d, 9), aLas(d, 12)).expect(201);

      await cambiar(id, { requiereVerificacion: true }).expect(200);

      const reserva = await prisma.reservation.findUniqueOrThrow({
        where: { id: creada.body.id },
      });
      expect(reserva.status).toBe('PENDIENTE');
    });
  });

  describe('precedencia y rastro', () => {
    it('E18: una publicación desactivada o inexistente da 404, no 422', async () => {
      const apagada = await publicacion(true, dueno, { isActive: false });
      const d = dia();

      await pedir(apagada, aLas(d, 9), aLas(d, 12)).expect(404);
      await pedir(randomUUID(), aLas(d, 9), aLas(d, 12)).expect(404);
    });

    it('E19: una fecha pasada da 400 aunque falte la verificación', async () => {
      const id = await publicacion(true);
      const ayer = new Date(Date.now() - DIA);

      const res = await pedir(id, ayer, new Date(ayer.getTime() + 3 * HORA)).expect(400);

      expect(res.body.codigo).toBe('FECHA_PASADA');
    });

    it('E20: el 422 no deja reserva ni aviso para el dueño', async () => {
      const id = await publicacion(true);
      const d = dia();
      const avisosAntes = await avisosDe(dueno);

      await pedir(id, aLas(d, 9), aLas(d, 12)).expect(422);

      expect(await reservasDe(id)).toBe(0);
      expect(await avisosDe(dueno)).toBe(avisosAntes);
    });

    it('E21: la opción no esconde la publicación: el detalle la muestra y la anuncia', async () => {
      const id = await publicacion(true);

      const res = await auth(
        http().get(`/api/v1/publicaciones/${id}`),
        sinVerificar,
      ).expect(200);

      expect(res.body).toMatchObject({ id, requiereVerificacion: true });
    });
  });
});
