import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '@Prisma/services';
import { PASARELA_CONFIG, type PasarelaConfig } from '@Payments/services';
import { createTestPrismaClient } from '../helpers/test-database.js';

/**
 * QA-10.1 (MP4-110): avisos, lectura y privacidad de la bandeja (H10).
 *
 * Recorre la historia desde el lado del usuario, con operaciones reales por
 * HTTP: un evento (reserva, decisión, pago o mensaje) → el aviso aparece en la
 * bandeja de su destinatario como pendiente y suma en el contador → se lee →
 * sigue en el historial marcado como leído y el contador baja. En cada paso
 * comprueba que el contador coincide con la bandeja.
 *
 * No repite lo que ya cubren:
 * - test/notifications.catalogo.e2e-spec.ts (BE-10.2): la fila de cada aviso
 *   en la base (título, mensaje, módulo, referencia) y el barrido de datos
 *   sensibles.
 * - test/notifications.bandeja.e2e-spec.ts (BE-10.1): filtro, paginación,
 *   forma de la respuesta y validación de parámetros, con avisos sembrados.
 *
 * Usuarios: A (arrendador), T (arrendatario) y X (un tercero, arrendatario).
 * Corre en paralelo con otros archivos: solo mira a sus propios usuarios
 * (email con un tag único) y borra lo que creó, de abajo hacia arriba.
 *
 * El servidor HTTP se levanta una sola vez, en 127.0.0.1, y todas las
 * peticiones van a esa URL. Con `request(app.getHttpServer())` supertest
 * levanta y cierra un servidor por petición en `::`; C11 falló una vez con un
 * 404 que no se pudo reproducir, y la hipótesis (no demostrada) es que, al
 * quedar libre el puerto entre peticiones, otro proceso local escuchando en
 * 127.0.0.1 en ese puerto recibió la petición. Escuchar en 127.0.0.1 durante
 * todo el archivo evita que el puerto se libere o se comparta.
 */
const prisma = createTestPrismaClient();
const pasarela: PasarelaConfig = { retardoMs: 0 };

interface Usuario {
  id: string;
  token: string;
}

interface Item {
  id: string;
  moduloOrigen: string;
  titulo: string;
  mensaje: string;
  referencia: { tipo: string; id: string } | null;
  leidaAt: string | null;
  creadaAt: string;
}

const BIEN = 'Cámara Canon R6';

describe('QA-10.1: avisos, lectura y privacidad de la bandeja', () => {
  const tag = `qa-10.1-${randomUUID()}@test.local`;
  let app: INestApplication;
  let A: Usuario;
  let T: Usuario;
  let X: Usuario;
  let listingId: string;
  let semana = 0;
  /** `http://127.0.0.1:<puerto>` del servidor levantado en beforeAll. */
  let baseUrl: string;

  const http = () => request(baseUrl);
  const auth = (u: Usuario) => ({ Authorization: `Bearer ${u.token}` });

  // --- La bandeja vista por cada usuario ----------------------------------

  async function bandeja(u: Usuario, soloNoLeidas = false) {
    const res = await http()
      .get('/api/v1/notificaciones')
      .query({ soloNoLeidas, limit: 100 })
      .set(auth(u))
      .expect(200);
    return res.body as { items: Item[]; total: number };
  }

  async function conteo(u: Usuario): Promise<number> {
    const res = await http()
      .get('/api/v1/notificaciones/no-leidas/conteo')
      .set(auth(u))
      .expect(200);
    return res.body.noLeidas as number;
  }

  /**
   * El contador coincide con la bandeja: conteo = total de «no leídas» =
   * items sin leer de la lista completa. Devuelve el conteo.
   */
  async function cuadra(u: Usuario): Promise<number> {
    const [n, todas, pendientes] = await Promise.all([
      conteo(u),
      bandeja(u),
      bandeja(u, true),
    ]);
    expect(pendientes.total).toBe(n);
    expect(pendientes.items).toHaveLength(n);
    expect(todas.items.filter((i) => i.leidaAt === null)).toHaveLength(n);
    expect(pendientes.items.every((i) => i.leidaAt === null)).toBe(true);
    return n;
  }

  /** Los avisos de la bandeja de `u` con esa referencia. */
  async function conReferencia(u: Usuario, tipo: string, id: string) {
    const { items } = await bandeja(u);
    return items.filter(
      (i) => i.referencia?.tipo === tipo && i.referencia.id === id,
    );
  }

  /** El único aviso de `u` con esa referencia y ese título, pendiente. */
  async function pendienteEn(
    u: Usuario,
    ref: { tipo: string; id: string },
    titulo: string,
  ): Promise<Item> {
    const items = (await conReferencia(u, ref.tipo, ref.id)).filter(
      (i) => i.titulo === titulo,
    );
    expect(items).toHaveLength(1);
    expect(items[0].leidaAt).toBeNull();
    return items[0];
  }

  const marcar = (u: Usuario | null, id: string) => {
    const req = http().patch(`/api/v1/notificaciones/${id}/leida`);
    return u ? req.set(auth(u)) : req;
  };

  // --- Operaciones que originan avisos -------------------------------------

  async function solicitar(): Promise<string> {
    const inicio = new Date(Date.UTC(2027, 5, 1 + 7 * semana++, 15));
    const fin = new Date(inicio.getTime() + 2 * 24 * 3_600_000);
    const res = await http()
      .post('/api/v1/reservas')
      .set(auth(T))
      .send({
        publicacionId: listingId,
        inicio: inicio.toISOString(),
        fin: fin.toISOString(),
      })
      .expect(201);
    return res.body.id as string;
  }

  const decidir = (id: string, body: Record<string, unknown>) =>
    http().patch(`/api/v1/reservas/${id}/decision`).set(auth(A)).send(body);

  async function confirmada(): Promise<string> {
    const id = await solicitar();
    await decidir(id, { decision: 'APROBAR' }).expect(200);
    return id;
  }

  const pagar = (reservaId: string, ultimos4: '4242' | '0002') =>
    http()
      .post(`/api/v1/reservas/${reservaId}/pagos/simulados`)
      .set(auth(T))
      .send({
        numeroTarjeta: `555566667777${ultimos4}`,
        vencimiento: '12/28',
        cvv: '123',
      });

  async function enviar(conversacionId: string, autor: Usuario) {
    const res = await http()
      .post(`/api/v1/conversaciones/${conversacionId}/mensajes`)
      .set(auth(autor))
      .send({ contenido: `Hola ${randomUUID()}` })
      .expect(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
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
    // Un solo servidor para todo el archivo, solo en 127.0.0.1 (ver arriba).
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${port}`;

    const jwt = app.get(JwtService);
    const crear = async (
      nombre: string,
      role: 'ARRENDADOR' | 'ARRENDATARIO',
    ): Promise<Usuario> => {
      const email = `${nombre}-${tag}`;
      const { id } = await prisma.user.create({
        data: { email, passwordHash: 'no-es-un-hash-real', role },
      });
      return { id, token: await jwt.signAsync({ sub: id, email }) };
    };
    A = await crear('arrendador', 'ARRENDADOR');
    T = await crear('arrendatario', 'ARRENDATARIO');
    X = await crear('tercero', 'ARRENDATARIO');

    ({ id: listingId } = await prisma.listing.create({
      data: {
        landlordId: A.id,
        type: 'EQUIPO',
        name: BIEN,
        location: 'San Salvador',
        rateAmount: '30.00',
        rateUnit: 'DIA',
        depositAmount: '15.00',
      },
      select: { id: true },
    }));
  });

  afterAll(async () => {
    const usuarios = { email: { endsWith: tag } };
    await prisma.notification.deleteMany({ where: { user: usuarios } });
    // Los mensajes se van en cascada con la conversación.
    await prisma.conversation.deleteMany({ where: { listingId } });
    await prisma.simulatedPayment.deleteMany({
      where: { reservation: { listingId } },
    });
    await prisma.reservation.deleteMany({ where: { listingId } });
    await prisma.listing.deleteMany({ where: { id: listingId } });
    await prisma.user.deleteMany({ where: usuarios });
    await app.close();
    await prisma.$disconnect();
  });

  describe('los eventos llegan a la bandeja de su destinatario', () => {
    it('C01: solicitud nueva → pendiente en la bandeja del arrendador, no en otras', async () => {
      const antes = await cuadra(A);
      const reservaId = await solicitar();
      const ref = { tipo: 'reserva', id: reservaId };

      const item = await pendienteEn(A, ref, 'Nueva solicitud de reserva');
      expect(item.moduloOrigen).toBe('RESERVAS');
      expect(await cuadra(A)).toBe(antes + 1);
      expect(await conReferencia(T, 'reserva', reservaId)).toHaveLength(0);
      expect(await conReferencia(X, 'reserva', reservaId)).toHaveLength(0);
    });

    it('C02: aprobación → «Reserva CONFIRMADA» pendiente para el arrendatario', async () => {
      const reservaId = await solicitar();
      const antesT = await cuadra(T);
      const antesA = await cuadra(A);
      await decidir(reservaId, { decision: 'APROBAR' }).expect(200);

      await pendienteEn(
        T,
        { tipo: 'reserva', id: reservaId },
        'Reserva CONFIRMADA',
      );
      expect(await cuadra(T)).toBe(antesT + 1);
      // El arrendador no recibe nada por su propia decisión.
      expect(await cuadra(A)).toBe(antesA);
      expect(await conReferencia(X, 'reserva', reservaId)).toHaveLength(0);
    });

    it('C03: rechazo con motivo → «Reserva RECHAZADA» con el motivo para el arrendatario', async () => {
      const reservaId = await solicitar();
      const antesT = await cuadra(T);
      await decidir(reservaId, {
        decision: 'RECHAZAR',
        motivo: 'La cámara está en reparación',
      }).expect(200);

      const item = await pendienteEn(
        T,
        { tipo: 'reserva', id: reservaId },
        'Reserva RECHAZADA',
      );
      expect(item.mensaje).toContain('Motivo: La cámara está en reparación');
      expect(await cuadra(T)).toBe(antesT + 1);
      expect(await conReferencia(X, 'reserva', reservaId)).toHaveLength(0);
    });

    it('C04: pago rechazado → solo el arrendatario recibe «Pago rechazado»', async () => {
      const reservaId = await confirmada();
      const antesT = await cuadra(T);
      const antesA = await cuadra(A);
      const res = await pagar(reservaId, '0002').expect(201);
      const ref = { tipo: 'pago', id: res.body.pagoId as string };

      const item = await pendienteEn(T, ref, 'Pago rechazado');
      expect(item.moduloOrigen).toBe('PAGOS_GARANTIA');
      expect(await cuadra(T)).toBe(antesT + 1);
      expect(await cuadra(A)).toBe(antesA);
      expect(await conReferencia(A, ref.tipo, ref.id)).toHaveLength(0);
    });

    it('C05: pago aprobado → «Pago aprobado» al arrendatario y «Pago confirmado» al arrendador', async () => {
      const reservaId = await confirmada();
      const antesT = await cuadra(T);
      const antesA = await cuadra(A);
      const antesX = await cuadra(X);
      const res = await pagar(reservaId, '4242').expect(201);
      const ref = { tipo: 'pago', id: res.body.pagoId as string };

      await pendienteEn(T, ref, 'Pago aprobado');
      await pendienteEn(A, ref, 'Pago confirmado');
      // Cada uno solo tiene el suyo.
      expect(await conReferencia(T, ref.tipo, ref.id)).toHaveLength(1);
      expect(await conReferencia(A, ref.tipo, ref.id)).toHaveLength(1);
      expect(await cuadra(T)).toBe(antesT + 1);
      expect(await cuadra(A)).toBe(antesA + 1);
      expect(await cuadra(X)).toBe(antesX);
    });

    it('C06: mensaje nuevo → aviso al otro participante, en los dos sentidos', async () => {
      const conversacion = await http()
        .post(`/api/v1/publicaciones/${listingId}/conversaciones`)
        .set(auth(T))
        .expect((r) => expect([200, 201]).toContain(r.status));
      const conversacionId = conversacion.body.id as string;

      const antesA = await cuadra(A);
      const deT = await enviar(conversacionId, T);
      await pendienteEn(A, { tipo: 'mensaje', id: deT }, 'Mensaje nuevo');
      expect(await conReferencia(T, 'mensaje', deT)).toHaveLength(0);
      expect(await cuadra(A)).toBe(antesA + 1);

      const antesT = await cuadra(T);
      const deA = await enviar(conversacionId, A);
      await pendienteEn(T, { tipo: 'mensaje', id: deA }, 'Mensaje nuevo');
      expect(await conReferencia(A, 'mensaje', deA)).toHaveLength(0);
      expect(await cuadra(T)).toBe(antesT + 1);

      expect(await conReferencia(X, 'mensaje', deT)).toHaveLength(0);
      expect(await conReferencia(X, 'mensaje', deA)).toHaveLength(0);
    });
  });

  describe('lectura', () => {
    it('C07: leer un aviso lo marca, sigue en el historial y baja el contador', async () => {
      const reservaId = await solicitar();
      const ref = { tipo: 'reserva', id: reservaId };
      const item = await pendienteEn(A, ref, 'Nueva solicitud de reserva');
      const antes = await cuadra(A);
      const totalAntes = (await bandeja(A)).total;

      const res = await marcar(A, item.id).expect(200);
      expect(res.body.id).toBe(item.id);
      expect(res.body.leidaAt).not.toBeNull();

      // Sigue en la lista completa, marcado como leído: no se borró.
      const todas = await bandeja(A);
      expect(todas.total).toBe(totalAntes);
      const enHistorial = todas.items.find((i) => i.id === item.id);
      expect(enHistorial).toMatchObject({
        titulo: item.titulo,
        mensaje: item.mensaje,
        leidaAt: res.body.leidaAt,
      });
      // Ya no está entre las no leídas y el contador bajó 1.
      const pendientes = await bandeja(A, true);
      expect(pendientes.items.some((i) => i.id === item.id)).toBe(false);
      expect(await cuadra(A)).toBe(antes - 1);
    });

    it('C08: leerlo dos veces es idempotente', async () => {
      const reservaId = await solicitar();
      const item = await pendienteEn(
        A,
        { tipo: 'reserva', id: reservaId },
        'Nueva solicitud de reserva',
      );
      const primera = await marcar(A, item.id).expect(200);
      const despues = await cuadra(A);

      const segunda = await marcar(A, item.id).expect(200);
      expect(segunda.body.leidaAt).toBe(primera.body.leidaAt);
      expect(await cuadra(A)).toBe(despues);
      expect(
        (await conReferencia(A, 'reserva', reservaId)).filter(
          (i) => i.titulo === 'Nueva solicitud de reserva',
        ),
      ).toHaveLength(1);
    });
  });

  describe('privacidad', () => {
    it('C09: una notificación ajena responde igual que una inexistente y no se modifica', async () => {
      const reservaId = await solicitar();
      const deA = await pendienteEn(
        A,
        { tipo: 'reserva', id: reservaId },
        'Nueva solicitud de reserva',
      );
      const antesA = await cuadra(A);
      const antesX = await cuadra(X);

      const ajena = await marcar(X, deA.id).expect(404);
      const inexistente = await marcar(X, randomUUID()).expect(404);
      // Mismo cuerpo completo: no revela que el id existe.
      expect(ajena.body).toEqual(inexistente.body);
      expect(JSON.stringify(ajena.body)).not.toContain(deA.id);

      // X no la ve en su bandeja.
      const deX = await bandeja(X);
      expect(deX.items.some((i) => i.id === deA.id)).toBe(false);
      // La de A sigue pendiente y los contadores no cambian.
      await pendienteEn(
        A,
        { tipo: 'reserva', id: reservaId },
        'Nueva solicitud de reserva',
      );
      expect(await cuadra(A)).toBe(antesA);
      expect(await cuadra(X)).toBe(antesX);
    });

    it('C10: sin sesión los tres endpoints responden 401 y no se modifica nada', async () => {
      const reservaId = await solicitar();
      const deA = await pendienteEn(
        A,
        { tipo: 'reserva', id: reservaId },
        'Nueva solicitud de reserva',
      );
      const antes = await cuadra(A);

      await http().get('/api/v1/notificaciones').expect(401);
      await http().get('/api/v1/notificaciones/no-leidas/conteo').expect(401);
      await marcar(null, deA.id).expect(401);

      await pendienteEn(
        A,
        { tipo: 'reserva', id: reservaId },
        'Nueva solicitud de reserva',
      );
      expect(await cuadra(A)).toBe(antes);
    });
  });

  describe('recorrido completo y reintentos', () => {
    it('C11: evento → pendiente → contador → lectura → historial → contador baja, cuadrando en cada paso', async () => {
      const a0 = await cuadra(A);
      const t0 = await cuadra(T);

      // 1. Solicitud: +1 para A.
      const reservaId = await solicitar();
      const ref = { tipo: 'reserva', id: reservaId };
      const solicitud = await pendienteEn(A, ref, 'Nueva solicitud de reserva');
      expect(await cuadra(A)).toBe(a0 + 1);
      expect(await cuadra(T)).toBe(t0);

      // 2. Aprobación: +1 para T.
      await decidir(reservaId, { decision: 'APROBAR' }).expect(200);
      const confirmacion = await pendienteEn(T, ref, 'Reserva CONFIRMADA');
      expect(await cuadra(T)).toBe(t0 + 1);

      // 3. Pago aprobado: +1 para cada uno.
      const pago = await pagar(reservaId, '4242').expect(201);
      const refPago = { tipo: 'pago', id: pago.body.pagoId as string };
      const pagoT = await pendienteEn(T, refPago, 'Pago aprobado');
      const pagoA = await pendienteEn(A, refPago, 'Pago confirmado');
      expect(await cuadra(A)).toBe(a0 + 2);
      expect(await cuadra(T)).toBe(t0 + 2);

      // 4. Cada uno lee lo suyo: el contador baja y el historial se conserva.
      for (const [u, item, esperado] of [
        [A, solicitud, a0 + 1],
        [A, pagoA, a0],
        [T, confirmacion, t0 + 1],
        [T, pagoT, t0],
      ] as const) {
        await marcar(u, item.id).expect(200);
        expect(await cuadra(u)).toBe(esperado);
        const enHistorial = (await bandeja(u)).items.find(
          (i) => i.id === item.id,
        );
        expect(enHistorial?.leidaAt).not.toBeNull();
      }
    });

    it('C12: reintentar la decisión o el pago aprobado no duplica avisos en la bandeja', async () => {
      const reservaId = await solicitar();
      await decidir(reservaId, { decision: 'APROBAR' }).expect(200);
      const pago = await pagar(reservaId, '4242').expect(201);
      const refPago = { tipo: 'pago', id: pago.body.pagoId as string };
      const antesA = await cuadra(A);
      const antesT = await cuadra(T);

      await decidir(reservaId, { decision: 'APROBAR' }).expect(409);
      await decidir(reservaId, { decision: 'RECHAZAR' }).expect(409);
      const repetido = await pagar(reservaId, '4242').expect(409);
      expect(repetido.body.codigo).toBe('PAGO_YA_APROBADO');

      const titulos = async (u: Usuario, tipo: string, id: string) =>
        (await conReferencia(u, tipo, id)).map((i) => i.titulo).sort();
      expect(await titulos(A, 'reserva', reservaId)).toEqual([
        'Nueva solicitud de reserva',
      ]);
      expect(await titulos(T, 'reserva', reservaId)).toEqual([
        'Reserva CONFIRMADA',
      ]);
      expect(await titulos(A, refPago.tipo, refPago.id)).toEqual([
        'Pago confirmado',
      ]);
      expect(await titulos(T, refPago.tipo, refPago.id)).toEqual([
        'Pago aprobado',
      ]);
      expect(await cuadra(A)).toBe(antesA);
      expect(await cuadra(T)).toBe(antesT);
    });
  });
});
