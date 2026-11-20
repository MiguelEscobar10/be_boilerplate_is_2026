import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '@Prisma/services';
// Como cualquier otro módulo: todo desde '@Notifications' (ver el contrato).
import {
  AvisoInvalidoError,
  AvisosService,
  ModuloOrigen,
  type Aviso,
  type CampoAviso,
} from '@Notifications';
import {
  avisarDecisionReserva,
  avisarGarantiaResuelta,
  avisarMensajeNuevo,
  avisarPagoAprobado,
  avisarPagoRechazado,
  avisarSolicitudNueva,
} from '../contratos/servicio-avisos.ejemplos.js';
import { createTestPrismaClient } from '../helpers/test-database.js';

/**
 * QA-20.1 (MP4-114): pruebas del servicio de avisos y su contrato (H20).
 *
 * Los ids (C01 a C21) se repiten en docs/qa/QA-20.1-avisos.md. Cada caso llama
 * a AvisosService como lo haría otro módulo y revisa el resultado en la base y
 * en la bandeja de H10 (GET /api/v1/notificaciones con el JWT del destinatario,
 * obtenido con un login real).
 *
 * Corre contra la base `_test` (test/helpers/test-database.ts). Los correos
 * llevan un sufijo único por ejecución y en afterAll se borran solo esos
 * usuarios; la cascada se lleva sus avisos.
 */
const prisma = createTestPrismaClient();

interface ItemBandeja {
  id: string;
  moduloOrigen: string;
  titulo: string;
  mensaje: string;
  referencia: { tipo: string; id: string } | null;
  leidaAt: string | null;
  creadaAt: string;
}

type Quien = 'a' | 'b';

describe('QA-20.1: servicio de avisos y su contrato', () => {
  const suffix = `qa-20.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let avisos: AvisosService;
  const user: Record<Quien, { id: string; token: string }> = {
    a: { id: '', token: '' },
    b: { id: '', token: '' },
  };
  /** Un UUID válido que no es de ningún usuario (C12). */
  const inexistente = randomUUID();

  const http = () => request(app.getHttpServer());

  async function account(who: Quien, rol: 'ARRENDADOR' | 'ARRENDATARIO') {
    const email = `${who}-${suffix}`;
    const { body } = await http()
      .post('/api/v1/users')
      .send({ email, password, rol, nombre: who, telefono: '70001234' })
      .expect(201);
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    user[who] = { id: body.id, token: login.body.accessToken };
  }

  /** Bandeja completa (hasta 100) del usuario, leída por HTTP. */
  async function bandeja(who: Quien): Promise<ItemBandeja[]> {
    const { body } = await http()
      .get('/api/v1/notificaciones?limit=100')
      .set('Authorization', `Bearer ${user[who].token}`)
      .expect(200);
    return body.items as ItemBandeja[];
  }

  async function noLeidas(who: Quien): Promise<number> {
    const { body } = await http()
      .get('/api/v1/notificaciones/no-leidas/conteo')
      .set('Authorization', `Bearer ${user[who].token}`)
      .expect(200);
    return body.noLeidas as number;
  }

  /** Filas en la base de los usuarios de esta prueba (y del inexistente). */
  const contarFilas = () =>
    prisma.notification.count({
      where: { userId: { in: [user.a.id, user.b.id, inexistente] } },
    });

  /** Aviso válido para A; cada caso cambia solo lo que prueba. */
  function aviso(cambios: Partial<Aviso> = {}): Aviso {
    return {
      destinatarioId: user.a.id,
      titulo: 'Nueva solicitud de reserva',
      mensaje: 'Recibiste una solicitud de reserva para «Taladro percutor».',
      moduloOrigen: ModuloOrigen.RESERVAS,
      referencia: { tipo: 'reserva', id: randomUUID() },
      ...cambios,
    };
  }

  /**
   * Registra el aviso y comprueba que aparece en la bandeja del destinatario
   * como no leído, que sube su conteo y que no aparece en la del otro.
   */
  async function esperarEnBandeja(
    registrar: () => Promise<{ id: string }>,
    who: Quien = 'a',
  ): Promise<ItemBandeja> {
    const otro: Quien = who === 'a' ? 'b' : 'a';
    const conteoAntes = await noLeidas(who);
    const conteoOtroAntes = await noLeidas(otro);

    const { id } = await registrar();

    const item = (await bandeja(who)).find((i) => i.id === id);
    expect(item).toBeDefined();
    expect(item!.leidaAt).toBeNull();
    expect(Object.values(ModuloOrigen)).toContain(item!.moduloOrigen);
    expect(Object.keys(item!).sort()).toEqual(
      [
        'creadaAt',
        'id',
        'leidaAt',
        'mensaje',
        'moduloOrigen',
        'referencia',
        'titulo',
      ].sort(),
    );
    expect(await noLeidas(who)).toBe(conteoAntes + 1);

    expect((await bandeja(otro)).some((i) => i.id === id)).toBe(false);
    expect(await noLeidas(otro)).toBe(conteoOtroAntes);
    return item!;
  }

  /** Espera AVISO_INVALIDO en `campo` y que no se haya registrado nada. */
  async function esperarInvalido(entrada: unknown, campo: CampoAviso) {
    const filasAntes = await contarFilas();
    const conteoAntes = await noLeidas('a');

    const error = await avisos
      .notificar(entrada as Aviso)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AvisoInvalidoError);
    expect(error).toMatchObject({ codigo: 'AVISO_INVALIDO', campo });
    expect(await contarFilas()).toBe(filasAntes);
    expect(await noLeidas('a')).toBe(conteoAntes);
  }

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
    avisos = app.get(AvisosService);

    await account('a', 'ARRENDADOR');
    await account('b', 'ARRENDATARIO');
  }, 60_000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: suffix } } });
    await app.close();
    await prisma.$disconnect();
  });

  describe('avisos válidos', () => {
    it('C01: aviso válido con referencia', async () => {
      const entrada = aviso();
      const item = await esperarEnBandeja(() => avisos.notificar(entrada));
      expect(item).toMatchObject({
        moduloOrigen: 'RESERVAS',
        titulo: entrada.titulo,
        mensaje: entrada.mensaje,
        referencia: entrada.referencia,
      });
    });

    it('C02: aviso válido sin referencia', async () => {
      const item = await esperarEnBandeja(() =>
        avisos.notificar(
          aviso({ titulo: 'Mensaje nuevo', referencia: undefined }),
        ),
      );
      expect(item.referencia).toBeNull();
    });

    it('C03: título de 100 caracteres (borde válido)', async () => {
      const titulo = 't'.repeat(100);
      const item = await esperarEnBandeja(() =>
        avisos.notificar(aviso({ titulo })),
      );
      expect(item.titulo).toBe(titulo);
    });

    it('C04: mensaje de 500 caracteres (borde válido)', async () => {
      const mensaje = 'm'.repeat(500);
      const item = await esperarEnBandeja(() =>
        avisos.notificar(aviso({ mensaje })),
      );
      expect(item.mensaje).toBe(mensaje);
    });
  });

  describe('avisos inválidos: AvisoInvalidoError y ninguna fila nueva', () => {
    it('C05: sin destinatario', async () => {
      await esperarInvalido(
        aviso({ destinatarioId: undefined as never }),
        'destinatarioId',
      );
    });

    it('C06: sin título', async () => {
      await esperarInvalido(aviso({ titulo: undefined as never }), 'titulo');
    });

    it('C07: título vacío', async () => {
      await esperarInvalido(aviso({ titulo: '' }), 'titulo');
    });

    it('C08: título de solo espacios', async () => {
      await esperarInvalido(aviso({ titulo: '     ' }), 'titulo');
    });

    it('C09: título de 101 caracteres', async () => {
      await esperarInvalido(aviso({ titulo: 't'.repeat(101) }), 'titulo');
    });

    it('C10: mensaje de 501 caracteres', async () => {
      await esperarInvalido(aviso({ mensaje: 'm'.repeat(501) }), 'mensaje');
    });

    it('C11: módulo de origen fuera de la lista', async () => {
      await esperarInvalido(
        aviso({ moduloOrigen: 'INVENTADO' as ModuloOrigen }),
        'moduloOrigen',
      );
    });

    it('C12: destinatario inexistente', async () => {
      await esperarInvalido(
        aviso({ destinatarioId: inexistente }),
        'destinatarioId',
      );
    });
  });

  it('C13: aviso duplicado con la misma referencia', async () => {
    const referencia = { tipo: 'reserva', id: randomUUID() };
    const primero = await avisos.notificar(aviso({ referencia }));
    const filasAntes = await contarFilas();
    const conteoAntes = await noLeidas('a');

    const segundo = await avisos.notificar(
      aviso({ referencia, mensaje: 'Otro texto para el mismo evento.' }),
    );

    expect(segundo.id).toBe(primero.id);
    expect(await contarFilas()).toBe(filasAntes);
    expect(await noLeidas('a')).toBe(conteoAntes);
    const items = (await bandeja('a')).filter(
      (i) => i.referencia?.id === referencia.id,
    );
    expect(items).toHaveLength(1);
    expect(items[0].mensaje).toBe(aviso().mensaje);
  });

  describe('ejemplos del contrato contra la base real', () => {
    it('C14: BE-03.1 solicitud nueva llega al arrendador', async () => {
      const reserva = {
        id: randomUUID(),
        arrendadorId: user.a.id,
        bienNombre: 'Taladro percutor',
      };
      const item = await esperarEnBandeja(() =>
        avisarSolicitudNueva(avisos, reserva),
      );
      expect(item).toMatchObject({
        titulo: 'Nueva solicitud de reserva',
        moduloOrigen: 'RESERVAS',
        referencia: { tipo: 'reserva', id: reserva.id },
      });
    });

    it('C15: BE-04.1 reserva CONFIRMADA y RECHAZADA (motivo de 500) llegan al arrendatario', async () => {
      const reserva = {
        id: randomUUID(),
        arrendatarioId: user.b.id,
        bienNombre: 'Salón para eventos',
        fechaInicio: new Date('2026-12-01T15:00:00.000Z'),
        fechaFin: new Date('2026-12-03T15:00:00.000Z'),
      };
      const confirmada = await esperarEnBandeja(
        () => avisarDecisionReserva(avisos, reserva, 'CONFIRMADA'),
        'b',
      );
      expect(confirmada).toMatchObject({
        titulo: 'Reserva CONFIRMADA',
        moduloOrigen: 'RESERVAS',
        mensaje:
          'Tu reserva de «Salón para eventos» del 01/12/2026 al 03/12/2026 fue confirmada.',
      });

      const rechazada = await esperarEnBandeja(
        () =>
          avisarDecisionReserva(
            avisos,
            { ...reserva, id: randomUUID(), motivo: 'x'.repeat(500) },
            'RECHAZADA',
          ),
        'b',
      );
      expect(rechazada.titulo).toBe('Reserva RECHAZADA');
      expect(rechazada.mensaje).toContain('fue rechazada. Motivo: ');
      expect(Array.from(rechazada.mensaje).length).toBeLessThanOrEqual(500);
    });

    it('C16: BE-05.1 pago APROBADO avisa al arrendatario y al arrendador', async () => {
      const pago = {
        id: randomUUID(),
        arrendatarioId: user.b.id,
        arrendadorId: user.a.id,
        bienNombre: 'Taladro percutor',
        montoTotal: 45,
      };
      const conteo = { a: await noLeidas('a'), b: await noLeidas('b') };

      const [paraB, paraA] = await avisarPagoAprobado(avisos, pago);

      const itemB = (await bandeja('b')).find((i) => i.id === paraB.id);
      const itemA = (await bandeja('a')).find((i) => i.id === paraA.id);
      expect(itemB).toMatchObject({
        titulo: 'Pago aprobado',
        moduloOrigen: 'PAGOS_GARANTIA',
        referencia: { tipo: 'pago', id: pago.id },
        leidaAt: null,
      });
      expect(itemB!.mensaje).toContain('$45.00');
      expect(itemA).toMatchObject({
        titulo: 'Pago confirmado',
        moduloOrigen: 'PAGOS_GARANTIA',
        referencia: { tipo: 'pago', id: pago.id },
        leidaAt: null,
      });
      // Cada uno solo en su bandeja.
      expect((await bandeja('a')).some((i) => i.id === paraB.id)).toBe(false);
      expect((await bandeja('b')).some((i) => i.id === paraA.id)).toBe(false);
      expect(await noLeidas('a')).toBe(conteo.a + 1);
      expect(await noLeidas('b')).toBe(conteo.b + 1);
    });

    it('C17: BE-05.1 pago RECHAZADO llega al arrendatario', async () => {
      const pago = {
        id: randomUUID(),
        arrendatarioId: user.b.id,
        arrendadorId: user.a.id,
        bienNombre: 'Taladro percutor',
        montoTotal: 45,
      };
      const item = await esperarEnBandeja(
        () => avisarPagoRechazado(avisos, pago),
        'b',
      );
      expect(item).toMatchObject({
        titulo: 'Pago rechazado',
        moduloOrigen: 'PAGOS_GARANTIA',
        referencia: { tipo: 'pago', id: pago.id },
      });
    });

    it('C18: BE-09.2 garantía resuelta llega al arrendatario', async () => {
      const garantia = {
        reservaId: randomUUID(),
        arrendatarioId: user.b.id,
        bienNombre: 'Taladro percutor',
        montoLiberado: 15,
        montoRetenido: 5,
      };
      const item = await esperarEnBandeja(
        () => avisarGarantiaResuelta(avisos, garantia),
        'b',
      );
      expect(item).toMatchObject({
        titulo: 'Depósito de garantía resuelto',
        mensaje:
          'El depósito de garantía de «Taladro percutor» fue resuelto: monto liberado $15.00, monto retenido $5.00.',
        moduloOrigen: 'PAGOS_GARANTIA',
        referencia: { tipo: 'reserva', id: garantia.reservaId },
      });
    });

    it('C19: BE-15.1 mensaje nuevo llega al otro participante', async () => {
      const mensaje = {
        id: randomUUID(),
        destinatarioId: user.a.id,
        bienNombre: 'Taladro percutor',
      };
      const item = await esperarEnBandeja(() =>
        avisarMensajeNuevo(avisos, mensaje),
      );
      expect(item).toMatchObject({
        titulo: 'Mensaje nuevo',
        moduloOrigen: 'MENSAJERIA',
        referencia: { tipo: 'mensaje', id: mensaje.id },
      });
    });
  });

  describe('sin endpoint público', () => {
    it.each([
      ['C20', '/api/v1/notificaciones'],
      ['C21', '/api/v1/avisos'],
    ])('%s: POST %s responde 404 con y sin token', async (_id, ruta) => {
      const filasAntes = await contarFilas();
      const body = {
        destinatarioId: user.a.id,
        titulo: 'Intento externo',
        mensaje: 'No debería registrarse.',
        moduloOrigen: 'RESERVAS',
      };

      const sinToken = await http().post(ruta).send(body);
      expect(sinToken.status).toBe(404);
      const conToken = await http()
        .post(ruta)
        .set('Authorization', `Bearer ${user.a.token}`)
        .send(body);
      expect(conToken.status).toBe(404);

      expect(await contarFilas()).toBe(filasAntes);
    });
  });
});
