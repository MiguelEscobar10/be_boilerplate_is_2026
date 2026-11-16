/**
 * Verifica el contrato publicado en docs/contratos/servicio-avisos.md:
 * - `@Notifications` exporta exactamente la API pública, y se puede importar
 *   desde fuera del módulo.
 * - Cada ejemplo de servicio-avisos.ejemplos.ts pasa la validación real de
 *   AvisosService y usa el título y el módulo de la tabla de eventos.
 * - Los ejemplos del documento son copia exacta de servicio-avisos.ejemplos.ts.
 *
 * Corre en `npm test` (unitaria): el repositorio está simulado, no usa la base.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Notifications from '@Notifications';
import {
  AvisoInvalidoError,
  AvisosService,
  ModuloOrigen,
} from '@Notifications';
import type { NotificationRepository } from '@Notifications/repositories';
import {
  avisarDecisionReserva,
  avisarGarantiaResuelta,
  avisarMensajeNuevo,
  avisarPagoAprobado,
  avisarPagoRechazado,
  avisarSolicitudNueva,
  notificarSinInterrumpir,
} from './servicio-avisos.ejemplos.js';

const ARRENDADOR = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ARRENDATARIO = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const RESERVA = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
const PAGO = '3d4e5f6a-7b8c-4d9e-8f1a-2b3c4d5e6f7a';
const GARANTIA = '4e5f6a7b-8c9d-4e0f-9a2b-3c4d5e6f7a8b';
const MENSAJE = '5f6a7b8c-9d0e-4f1a-8b3c-4d5e6f7a8b9c';

const BIEN = 'Taladro percutor Bosch';
const PAGO_DATOS = {
  id: PAGO,
  arrendatarioId: ARRENDATARIO,
  arrendadorId: ARRENDADOR,
  bienNombre: BIEN,
  montoTotal: 45,
};

describe('Contrato del servicio de avisos', () => {
  let repo: {
    create: ReturnType<typeof vi.fn>;
    findByDedupeKey: ReturnType<typeof vi.fn>;
  };
  let avisos: AvisosService;

  beforeEach(() => {
    repo = {
      create: vi.fn().mockResolvedValue({ id: 'aviso-1' }),
      findByDedupeKey: vi.fn(),
    };
    avisos = new AvisosService(repo as unknown as NotificationRepository);
  });

  /** Lo que llegó al repositorio en cada llamada, ya validado y recortado. */
  function registrados() {
    return repo.create.mock.calls.map(([data]) => data);
  }

  describe('documento del contrato', () => {
    /** Lee un archivo del repo con saltos de línea normalizados. */
    const leer = (ruta: string) =>
      readFileSync(resolve(process.cwd(), ruta), 'utf8').replace(/\r\n/g, '\n');

    it('los ejemplos del .md son copia exacta de servicio-avisos.ejemplos.ts', () => {
      const ejemplos = leer('test/contratos/servicio-avisos.ejemplos.ts');
      const doc = leer('docs/contratos/servicio-avisos.md');
      const seccion = doc.slice(doc.indexOf('## Ejemplos por módulo emisor'));
      const bloques = [...seccion.matchAll(/```ts\n([\s\S]*?)```/g)].map(
        ([, codigo]) => codigo,
      );

      // import + BE-03.1, BE-04.1, BE-05.1, BE-09.2, BE-15.1 + manejo de errores
      expect(bloques).toHaveLength(7);
      for (const bloque of bloques) {
        expect(ejemplos).toContain(bloque);
      }
    });
  });

  describe('exports de @Notifications', () => {
    it('publica solo la API del servicio de avisos', () => {
      // Los tipos (Aviso, ReferenciaAviso, AvisoRegistrado, CampoAviso) no
      // existen en tiempo de ejecución; los cubre la compilación de los
      // ejemplos.
      expect(Object.keys(Notifications).sort()).toEqual([
        'AvisoInvalidoError',
        'AvisosService',
        'ModuloOrigen',
        'NotificationsModule',
      ]);
    });

    it('ModuloOrigen trae los valores del enum de DB-20.1', () => {
      expect(Object.values(ModuloOrigen)).toEqual([
        'CATALOGO',
        'BUSQUEDA',
        'RESERVAS',
        'PAGOS_GARANTIA',
        'MENSAJERIA',
        'RESENAS',
        'VERIFICACION',
        'NOTIFICACIONES',
        'REPORTES',
      ]);
    });
  });

  describe('ejemplos por módulo emisor', () => {
    it('BE-03.1: solicitud nueva → arrendador', async () => {
      await expect(
        avisarSolicitudNueva(avisos, {
          id: RESERVA,
          arrendadorId: ARRENDADOR,
          bienNombre: BIEN,
        }),
      ).resolves.toEqual({ id: 'aviso-1' });

      expect(registrados()).toEqual([
        {
          userId: ARRENDADOR,
          sourceModule: 'RESERVAS',
          title: 'Nueva solicitud de reserva',
          message: `Recibiste una solicitud de reserva para «${BIEN}».`,
          referenceType: 'reserva',
          referenceId: RESERVA,
        },
      ]);
    });

    it.each([
      ['CONFIRMADA', 'Reserva CONFIRMADA', 'confirmada'],
      ['RECHAZADA', 'Reserva RECHAZADA', 'rechazada'],
    ] as const)(
      'BE-04.1: reserva %s → arrendatario',
      async (estado, titulo, resultado) => {
        await avisarDecisionReserva(
          avisos,
          { id: RESERVA, arrendatarioId: ARRENDATARIO, bienNombre: BIEN },
          estado,
        );

        expect(registrados()).toEqual([
          {
            userId: ARRENDATARIO,
            sourceModule: 'RESERVAS',
            title: titulo,
            message: `Tu reserva de «${BIEN}» fue ${resultado}.`,
            referenceType: 'reserva',
            referenceId: RESERVA,
          },
        ]);
      },
    );

    it('BE-05.1: pago APROBADO → arrendatario y arrendador', async () => {
      await expect(
        avisarPagoAprobado(avisos, PAGO_DATOS),
      ).resolves.toHaveLength(2);

      expect(registrados()).toEqual([
        expect.objectContaining({
          userId: ARRENDATARIO,
          sourceModule: 'PAGOS_GARANTIA',
          title: 'Pago aprobado',
          referenceType: 'pago',
          referenceId: PAGO,
        }),
        expect.objectContaining({
          userId: ARRENDADOR,
          sourceModule: 'PAGOS_GARANTIA',
          title: 'Pago confirmado',
          referenceType: 'pago',
          referenceId: PAGO,
        }),
      ]);
      // H05: el mensaje incluye el bien y el monto total con dos decimales.
      for (const { message } of registrados()) {
        expect(message).toContain(BIEN);
        expect(message).toContain('$45.00');
      }
    });

    it('BE-05.1: pago RECHAZADO → solo arrendatario', async () => {
      await avisarPagoRechazado(avisos, PAGO_DATOS);

      expect(registrados()).toEqual([
        expect.objectContaining({
          userId: ARRENDATARIO,
          sourceModule: 'PAGOS_GARANTIA',
          title: 'Pago rechazado',
          referenceType: 'pago',
          referenceId: PAGO,
        }),
      ]);
      expect(registrados()[0].message).toContain('$45.00');
    });

    it.each([
      ['LIBERADA', 'liberado'],
      ['RETENIDA', 'retenido'],
    ] as const)(
      'BE-09.2: garantía %s → arrendatario',
      async (estado, resultado) => {
        await avisarGarantiaResuelta(avisos, {
          id: GARANTIA,
          arrendatarioId: ARRENDATARIO,
          bienNombre: BIEN,
          estado,
        });

        expect(registrados()).toEqual([
          {
            userId: ARRENDATARIO,
            sourceModule: 'PAGOS_GARANTIA',
            title: 'Depósito de garantía resuelto',
            message: `El depósito de garantía de «${BIEN}» fue ${resultado}.`,
            referenceType: 'garantia',
            referenceId: GARANTIA,
          },
        ]);
      },
    );

    it('BE-15.1: mensaje nuevo → el otro participante', async () => {
      await avisarMensajeNuevo(avisos, {
        id: MENSAJE,
        destinatarioId: ARRENDADOR,
        remitenteNombre: 'Ana',
      });

      expect(registrados()).toEqual([
        {
          userId: ARRENDADOR,
          sourceModule: 'MENSAJERIA',
          title: 'Mensaje nuevo',
          message: 'Ana te envió un mensaje.',
          referenceType: 'mensaje',
          referenceId: MENSAJE,
        },
      ]);
    });
  });

  describe('manejo de errores', () => {
    it('AvisoInvalidoError expone codigo y campo, y no registra nada', async () => {
      const error = await avisos
        .notificar({
          destinatarioId: ARRENDATARIO,
          titulo: '   ',
          mensaje: 'x',
          moduloOrigen: ModuloOrigen.RESERVAS,
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(AvisoInvalidoError);
      expect(error).toMatchObject({
        codigo: 'AVISO_INVALIDO',
        campo: 'titulo',
      });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('notificarSinInterrumpir reporta un AvisoInvalidoError y devuelve null', async () => {
      const reportar = vi.fn();

      await expect(
        notificarSinInterrumpir(
          avisos,
          {
            destinatarioId: ARRENDATARIO,
            titulo: 'Pago rechazado',
            mensaje: 'x'.repeat(501),
            moduloOrigen: ModuloOrigen.PAGOS_GARANTIA,
          },
          reportar,
        ),
      ).resolves.toBeNull();

      expect(reportar).toHaveBeenCalledWith(
        expect.stringContaining('AVISO_INVALIDO en mensaje'),
      );
    });

    it('notificarSinInterrumpir propaga los demás errores', async () => {
      repo.create.mockRejectedValue(new Error('base caída'));

      await expect(
        notificarSinInterrumpir(
          avisos,
          {
            destinatarioId: ARRENDATARIO,
            titulo: 'Mensaje nuevo',
            mensaje: 'Ana te envió un mensaje.',
            moduloOrigen: ModuloOrigen.MENSAJERIA,
          },
          vi.fn(),
        ),
      ).rejects.toThrow('base caída');
    });
  });
});
