import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '@Prisma/services';
import { AvisosService, ModuloOrigen } from '@Notifications';
import { PASARELA_CONFIG, type PasarelaConfig } from '@Payments/services';
import { createTestPrismaClient } from './helpers/test-database.js';

/**
 * Catálogo de avisos (BE-10.2): para cada evento del catálogo se ejecuta la
 * operación real por HTTP y se comprueba el aviso que quedó en la base
 * (destinatario, título, mensaje, módulo de origen y referencia), que repetir
 * la operación no lo duplica y que ningún aviso trae datos sensibles.
 *
 * - App completa contra la base `_test` (ver test/helpers/test-database.ts).
 * - La pasarela responde sin esperar.
 * - Corre en paralelo con otros archivos: las consultas filtran siempre por
 *   los usuarios de este archivo (email con un sufijo propio) y por la
 *   referencia del caso, nunca por conteos globales.
 * - En afterAll borra solo lo que creó, de abajo hacia arriba.
 */
const prisma = createTestPrismaClient();
const pasarela: PasarelaConfig = { retardoMs: 0 };

/** Tarjetas con números poco comunes, para buscarlos en los avisos. */
const NUMERO_APRUEBA = '5555666677774242';
const NUMERO_RECHAZA = '5555666677770002';
const CVV = '8613';
const PASSWORD_HASH = `hash-${randomUUID()}`;

const BIEN = 'Proyector Epson';
/** 2 días a 20.05 más 9.95 de depósito. */
const MONTO_TOTAL = '$50.05';

interface Usuario {
  id: string;
  token: string;
}

describe('catálogo de avisos (BE-10.2)', () => {
  const sufijo = `be-10.2-${randomUUID()}@test.local`;
  let app: INestApplication;
  let avisos: AvisosService;
  let arrendatario: Usuario;
  let arrendador: Usuario;
  let listingId: string;
  /** Lo que se escribió en el chat: no puede aparecer en ningún aviso. */
  const textosDelChat: string[] = [];
  /** Cada reserva usa una semana distinta para que no choquen. */
  let semana = 0;

  const http = () => request(app.getHttpServer());
  const auth = (u: Usuario) => ({ Authorization: `Bearer ${u.token}` });

  /** Reserva de 2 días que empieza a las 15:00 UTC (09:00 en El Salvador). */
  function periodo() {
    const inicio = new Date(Date.UTC(2027, 2, 1 + 7 * semana++, 15));
    const fin = new Date(inicio.getTime() + 2 * 24 * 3_600_000);
    return { inicio, fin };
  }

  /** dd/mm/aaaa 09:00 de un instante a las 15:00 UTC. */
  function local(instante: Date): string {
    const dd = String(instante.getUTCDate()).padStart(2, '0');
    const mm = String(instante.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${instante.getUTCFullYear()} 09:00`;
  }

  async function solicitar() {
    const { inicio, fin } = periodo();
    const res = await http()
      .post('/api/v1/reservas')
      .set(auth(arrendatario))
      .send({
        publicacionId: listingId,
        inicio: inicio.toISOString(),
        fin: fin.toISOString(),
      })
      .expect(201);
    return { id: res.body.id as string, inicio, fin };
  }

  const decidir = (id: string, body: Record<string, unknown>) =>
    http()
      .patch(`/api/v1/reservas/${id}/decision`)
      .set(auth(arrendador))
      .send(body);

  async function reservaConfirmada() {
    const reserva = await solicitar();
    await decidir(reserva.id, { decision: 'APROBAR' }).expect(200);
    return reserva;
  }

  const pagar = (reservaId: string, numeroTarjeta: string) =>
    http()
      .post(`/api/v1/reservas/${reservaId}/pagos/simulados`)
      .set(auth(arrendatario))
      .send({ numeroTarjeta, vencimiento: '12/28', cvv: CVV });

  async function enviar(conversacionId: string, autor: Usuario) {
    const contenido = `Texto privado ${randomUUID()}`;
    textosDelChat.push(contenido);
    const res = await http()
      .post(`/api/v1/conversaciones/${conversacionId}/mensajes`)
      .set(auth(autor))
      .send({ contenido })
      .expect(201);
    return res.body.id as string;
  }

  /** Avisos de `userId` con esa referencia. */
  const avisosDe = (userId: string, tipo: string, id: string) =>
    prisma.notification.findMany({
      where: { userId, referenceType: tipo, referenceId: id },
      orderBy: { createdAt: 'asc' },
    });

  /** Avisos de pago de `userId` sobre cualquier intento de la reserva. */
  async function avisosDePago(userId: string, reservaId: string) {
    const pagos = await prisma.simulatedPayment.findMany({
      where: { reservationId: reservaId },
      select: { id: true },
    });
    return prisma.notification.findMany({
      where: {
        userId,
        referenceType: 'pago',
        referenceId: { in: pagos.map((p) => p.id) },
      },
    });
  }

  /** Comprueba el único aviso de `userId` con esa referencia. */
  async function esperarAviso(
    userId: string,
    referencia: { tipo: string; id: string },
    esperado: { titulo: string; mensaje: string; modulo: ModuloOrigen },
  ) {
    const filas = await avisosDe(userId, referencia.tipo, referencia.id);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      title: esperado.titulo,
      message: esperado.mensaje,
      sourceModule: esperado.modulo,
      readAt: null,
    });
    return filas[0];
  }

  /**
   * Repite el aviso tal como quedó registrado: notificar devuelve el mismo id
   * y no aparece otro (deduplicación por destinatario, módulo, referencia y
   * título).
   */
  async function reintentarAviso(fila: {
    id: string;
    userId: string;
    sourceModule: ModuloOrigen;
    title: string;
    message: string;
    referenceType: string | null;
    referenceId: string | null;
  }) {
    const { id } = await avisos.notificar({
      destinatarioId: fila.userId,
      titulo: fila.title,
      mensaje: fila.message,
      moduloOrigen: fila.sourceModule,
      referencia: { tipo: fila.referenceType!, id: fila.referenceId! },
    });
    expect(id).toBe(fila.id);
    expect(
      await avisosDe(fila.userId, fila.referenceType!, fila.referenceId!),
    ).toHaveLength(1);
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
    avisos = app.get(AvisosService);

    const jwt = app.get(JwtService);
    const crear = async (
      nombre: string,
      role: 'ARRENDADOR' | 'ARRENDATARIO',
    ): Promise<Usuario> => {
      const email = `${nombre}-${sufijo}`;
      const { id } = await prisma.user.create({
        data: { email, passwordHash: PASSWORD_HASH, role },
      });
      return { id, token: await jwt.signAsync({ sub: id, email }) };
    };
    arrendatario = await crear('arrendatario', 'ARRENDATARIO');
    arrendador = await crear('arrendador', 'ARRENDADOR');

    ({ id: listingId } = await prisma.listing.create({
      data: {
        landlordId: arrendador.id,
        type: 'EQUIPO',
        name: BIEN,
        location: 'Santa Tecla',
        rateAmount: '20.05',
        rateUnit: 'DIA',
        depositAmount: '9.95',
      },
      select: { id: true },
    }));
  });

  afterAll(async () => {
    const usuarios = { email: { endsWith: sufijo } };
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

  describe('solicitud nueva (BE-03.1)', () => {
    it('avisa al arrendador, no al arrendatario', async () => {
      const { id, inicio, fin } = await solicitar();
      const ref = { tipo: 'reserva', id };

      const fila = await esperarAviso(arrendador.id, ref, {
        titulo: 'Nueva solicitud de reserva',
        mensaje: `Solicitud de «${BIEN}» del ${local(inicio)} al ${local(fin)}.`,
        modulo: ModuloOrigen.RESERVAS,
      });
      expect(await avisosDe(arrendatario.id, 'reserva', id)).toHaveLength(0);

      await reintentarAviso(fila);
    });
  });

  describe('decisión de la reserva (BE-04.1)', () => {
    it('CONFIRMADA avisa al arrendatario; repetir la decisión da 409 sin otro aviso', async () => {
      const { id, inicio, fin } = await solicitar();
      await decidir(id, { decision: 'APROBAR' }).expect(200);
      const ref = { tipo: 'reserva', id };

      const fila = await esperarAviso(arrendatario.id, ref, {
        titulo: 'Reserva CONFIRMADA',
        mensaje: `Tu reserva de «${BIEN}» del ${local(inicio)} al ${local(fin)} fue confirmada.`,
        modulo: ModuloOrigen.RESERVAS,
      });
      // El arrendador solo tiene el de la solicitud.
      const delArrendador = await avisosDe(arrendador.id, 'reserva', id);
      expect(delArrendador.map((a) => a.title)).toEqual([
        'Nueva solicitud de reserva',
      ]);

      await decidir(id, { decision: 'APROBAR' }).expect(409);
      await decidir(id, { decision: 'RECHAZAR' }).expect(409);
      expect(await avisosDe(arrendatario.id, 'reserva', id)).toHaveLength(1);
      await reintentarAviso(fila);
    });

    it('RECHAZADA avisa al arrendatario con el motivo; repetir da 409 sin otro aviso', async () => {
      const { id, inicio, fin } = await solicitar();
      await decidir(id, {
        decision: 'RECHAZAR',
        motivo: 'El equipo está en mantenimiento',
      }).expect(200);
      const ref = { tipo: 'reserva', id };

      const fila = await esperarAviso(arrendatario.id, ref, {
        titulo: 'Reserva RECHAZADA',
        mensaje: `Tu reserva de «${BIEN}» del ${local(inicio)} al ${local(fin)} fue rechazada. Motivo: El equipo está en mantenimiento`,
        modulo: ModuloOrigen.RESERVAS,
      });

      await decidir(id, { decision: 'RECHAZAR' }).expect(409);
      expect(await avisosDe(arrendatario.id, 'reserva', id)).toHaveLength(1);
      await reintentarAviso(fila);
    });
  });

  describe('pago simulado (BE-05.1)', () => {
    it('cada intento RECHAZADO avisa solo al arrendatario, con su propio aviso', async () => {
      const { id: reservaId } = await reservaConfirmada();

      const pagos: string[] = [];
      for (let i = 0; i < 2; i++) {
        const res = await pagar(reservaId, NUMERO_RECHAZA).expect(201);
        expect(res.body.estado).toBe('RECHAZADO');
        pagos.push(res.body.pagoId as string);
      }
      expect(new Set(pagos).size).toBe(2);

      for (const pagoId of pagos) {
        const fila = await esperarAviso(
          arrendatario.id,
          { tipo: 'pago', id: pagoId },
          {
            titulo: 'Pago rechazado',
            mensaje: `Tu pago de ${MONTO_TOTAL} por «${BIEN}» fue rechazado. La reserva sigue confirmada y puedes intentar el pago de nuevo.`,
            modulo: ModuloOrigen.PAGOS_GARANTIA,
          },
        );
        await reintentarAviso(fila);
      }
      expect(await avisosDePago(arrendador.id, reservaId)).toHaveLength(0);
    });

    it('APROBADO avisa al arrendatario y al arrendador («Pago confirmado»); repetir da 409 sin avisos nuevos', async () => {
      const { id: reservaId } = await reservaConfirmada();
      const res = await pagar(reservaId, NUMERO_APRUEBA).expect(201);
      expect(res.body.estado).toBe('APROBADO');
      const ref = { tipo: 'pago', id: res.body.pagoId as string };

      const delArrendatario = await esperarAviso(arrendatario.id, ref, {
        titulo: 'Pago aprobado',
        mensaje: `Tu pago de ${MONTO_TOTAL} por «${BIEN}» fue aprobado.`,
        modulo: ModuloOrigen.PAGOS_GARANTIA,
      });
      const delArrendador = await esperarAviso(arrendador.id, ref, {
        titulo: 'Pago confirmado',
        mensaje: `Se confirmó el pago de ${MONTO_TOTAL} de la reserva de «${BIEN}».`,
        modulo: ModuloOrigen.PAGOS_GARANTIA,
      });

      const repetido = await pagar(reservaId, NUMERO_APRUEBA).expect(409);
      expect(repetido.body.codigo).toBe('PAGO_YA_APROBADO');
      expect(
        await prisma.simulatedPayment.count({
          where: { reservationId: reservaId },
        }),
      ).toBe(1);
      expect(await avisosDePago(arrendatario.id, reservaId)).toHaveLength(1);
      expect(await avisosDePago(arrendador.id, reservaId)).toHaveLength(1);

      await reintentarAviso(delArrendatario);
      await reintentarAviso(delArrendador);
    });

    it('rechazado y luego aprobado: un aviso por intento, coherente con su resultado', async () => {
      const { id: reservaId } = await reservaConfirmada();
      const rechazado = await pagar(reservaId, NUMERO_RECHAZA).expect(201);
      const aprobado = await pagar(reservaId, NUMERO_APRUEBA).expect(201);

      const titulos = async (userId: string, pagoId: string) =>
        (await avisosDe(userId, 'pago', pagoId)).map((a) => a.title);
      expect(await titulos(arrendatario.id, rechazado.body.pagoId)).toEqual([
        'Pago rechazado',
      ]);
      expect(await titulos(arrendador.id, rechazado.body.pagoId)).toEqual([]);
      expect(await titulos(arrendatario.id, aprobado.body.pagoId)).toEqual([
        'Pago aprobado',
      ]);
      expect(await titulos(arrendador.id, aprobado.body.pagoId)).toEqual([
        'Pago confirmado',
      ]);
    });
  });

  describe('mensaje nuevo (BE-15.1)', () => {
    const mensajeEsperado = {
      titulo: 'Mensaje nuevo',
      mensaje: `Tenés un mensaje nuevo sobre "${BIEN}".`,
      modulo: ModuloOrigen.MENSAJERIA,
    };

    /** El aviso va al otro participante y nunca a quien escribe. */
    async function esperarAvisoDeMensaje(
      mensajeId: string,
      destinatario: Usuario,
      autor: Usuario,
    ) {
      const ref = { tipo: 'mensaje', id: mensajeId };
      const fila = await esperarAviso(destinatario.id, ref, mensajeEsperado);
      expect(await avisosDe(autor.id, 'mensaje', mensajeId)).toHaveLength(0);
      await reintentarAviso(fila);
    }

    it('H15: conversación sobre la publicación, en los dos sentidos', async () => {
      const conversacion = await http()
        .post(`/api/v1/publicaciones/${listingId}/conversaciones`)
        .set(auth(arrendatario))
        .expect((r) => expect([200, 201]).toContain(r.status));
      const conversacionId = conversacion.body.id as string;

      const pregunta = await enviar(conversacionId, arrendatario);
      await esperarAvisoDeMensaje(pregunta, arrendador, arrendatario);

      const respuesta = await enviar(conversacionId, arrendador);
      await esperarAvisoDeMensaje(respuesta, arrendatario, arrendador);
    });

    it('H16: conversación de una reserva confirmada, en los dos sentidos', async () => {
      const { id: reservaId } = await reservaConfirmada();
      const conversacion = await http()
        .post(`/api/v1/reservas/${reservaId}/conversacion`)
        .set(auth(arrendador))
        .expect((r) => expect([200, 201]).toContain(r.status));
      const conversacionId = conversacion.body.id as string;

      const delArrendador = await enviar(conversacionId, arrendador);
      await esperarAvisoDeMensaje(delArrendador, arrendatario, arrendador);

      const delArrendatario = await enviar(conversacionId, arrendatario);
      await esperarAvisoDeMensaje(delArrendatario, arrendador, arrendatario);
    });
  });

  describe('datos sensibles', () => {
    // Corre al final: barre todos los avisos que generaron los casos de arriba.
    it('ningún aviso trae tarjeta, CVV, documentos, contraseñas ni el texto del chat', async () => {
      const filas = await prisma.notification.findMany({
        where: { userId: { in: [arrendatario.id, arrendador.id] } },
      });

      // El barrido incluye todos los tipos del catálogo, pagos incluidos.
      const titulos = new Set(filas.map((f) => f.title));
      for (const titulo of [
        'Nueva solicitud de reserva',
        'Reserva CONFIRMADA',
        'Reserva RECHAZADA',
        'Pago aprobado',
        'Pago confirmado',
        'Pago rechazado',
        'Mensaje nuevo',
      ]) {
        expect(titulos).toContain(titulo);
      }

      const prohibidos: RegExp[] = [
        /\b\d{13,19}\b/, // número de tarjeta
        /\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{1,7}\b/, // tarjeta con separadores
        /\b\d{8}-\d\b/, // DUI
        /\b\d{4}-\d{6}-\d{3}-\d\b/, // NIT
        /cvv|c[oó]digo de seguridad|contrase[ñn]a|password/i,
      ];
      const literales = [
        NUMERO_APRUEBA,
        NUMERO_RECHAZA,
        NUMERO_APRUEBA.slice(-4),
        NUMERO_RECHAZA.slice(-4),
        CVV,
        PASSWORD_HASH,
        ...textosDelChat,
      ];

      for (const { title, message } of filas) {
        const texto = `${title}\n${message}`;
        for (const patron of prohibidos) expect(texto).not.toMatch(patron);
        for (const literal of literales) expect(texto).not.toContain(literal);
      }
    });
  });
});
