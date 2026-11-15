import { Injectable } from '@nestjs/common';
import { NotificationRepository } from '@Notifications/repositories';
import {
  AvisoDuplicadoError,
  AvisoInvalidoError,
  DestinatarioInexistenteError,
} from '@Notifications/errors';
import {
  ModuloOrigen,
  type Aviso,
  type AvisoRegistrado,
  type CampoAviso,
} from '@Notifications/types';

const TITULO_MAX = 100;
const MENSAJE_MAX = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODULOS_ORIGEN: readonly string[] = Object.values(ModuloOrigen);

/** Aviso ya validado y normalizado, listo para guardar. */
interface AvisoNormalizado {
  destinatarioId: string;
  titulo: string;
  mensaje: string;
  moduloOrigen: ModuloOrigen;
  referencia: { tipo: string; id: string } | null;
}

/**
 * Servicio de avisos (H20). Registra avisos para los demás módulos del
 * backend. Es interno: no tiene endpoint público.
 */
@Injectable()
export class AvisosService {
  constructor(
    private readonly notificationRepository: NotificationRepository,
  ) {}

  /**
   * Registra un aviso para su destinatario, como no leído.
   *
   * Título y mensaje se guardan sin los espacios de los extremos. Si ya existe
   * un aviso con el mismo destinatario, módulo, referencia y título, no crea
   * otro y devuelve el id del existente. Los avisos sin referencia no se
   * deduplican.
   *
   * Datos sensibles: título y mensaje nunca deben incluir números de tarjeta,
   * códigos de seguridad, números de documentos (DUI, NIT, pasaporte) ni
   * contraseñas. Los importes sí se permiten. El servicio no lo verifica: lo
   * garantiza quien llama.
   *
   * @throws {AvisoInvalidoError} con `codigo` AVISO_INVALIDO y el `campo` con
   *   error si el aviso no cumple el contrato o el destinatario no existe. En
   *   ese caso no se registra nada.
   */
  async notificar(aviso: Aviso): Promise<AvisoRegistrado> {
    const datos = this.validar(aviso);

    try {
      return await this.notificationRepository.create({
        userId: datos.destinatarioId,
        sourceModule: datos.moduloOrigen,
        title: datos.titulo,
        message: datos.mensaje,
        referenceType: datos.referencia?.tipo ?? null,
        referenceId: datos.referencia?.id ?? null,
      });
    } catch (error) {
      if (error instanceof DestinatarioInexistenteError) {
        throw new AvisoInvalidoError(
          'destinatarioId',
          'El destinatario no existe.',
        );
      }
      if (error instanceof AvisoDuplicadoError && datos.referencia) {
        // Otro llamado registró el mismo aviso antes (o al mismo tiempo):
        // se devuelve ese en vez de crear otro.
        const existente = await this.notificationRepository.findByDedupeKey({
          userId: datos.destinatarioId,
          sourceModule: datos.moduloOrigen,
          referenceType: datos.referencia.tipo,
          referenceId: datos.referencia.id,
          title: datos.titulo,
        });
        if (existente) return existente;
      }
      throw error;
    }
  }

  /**
   * Valida el aviso en el orden del contrato y reporta el primer campo con
   * error. Repite las reglas que la base ya impone con CHECK para dar un error
   * claro antes de llegar a ella. Es algo más estricta: `trim()` también quita
   * tabs y saltos de línea, mientras que `btrim` solo quita espacios.
   */
  private validar(aviso: Aviso): AvisoNormalizado {
    const entrada = (aviso ?? {}) as Partial<Record<keyof Aviso, unknown>>;

    const destinatarioId = texto(entrada.destinatarioId);
    if (!destinatarioId) {
      throw invalido('destinatarioId', 'El destinatario es obligatorio.');
    }
    if (!UUID.test(destinatarioId)) {
      throw invalido('destinatarioId', 'El destinatario debe ser un UUID.');
    }

    const titulo = this.validarLargo(
      entrada.titulo,
      'titulo',
      'El título',
      TITULO_MAX,
    );
    const mensaje = this.validarLargo(
      entrada.mensaje,
      'mensaje',
      'El mensaje',
      MENSAJE_MAX,
    );

    const moduloOrigen = entrada.moduloOrigen;
    if (
      typeof moduloOrigen !== 'string' ||
      !MODULOS_ORIGEN.includes(moduloOrigen)
    ) {
      throw invalido(
        'moduloOrigen',
        `El módulo de origen debe ser uno de: ${MODULOS_ORIGEN.join(', ')}.`,
      );
    }

    return {
      destinatarioId,
      titulo,
      mensaje,
      moduloOrigen: moduloOrigen as ModuloOrigen,
      referencia: this.validarReferencia(entrada.referencia),
    };
  }

  private validarLargo(
    valor: unknown,
    campo: CampoAviso,
    nombre: string,
    max: number,
  ): string {
    const recortado = texto(valor);
    if (!recortado) {
      throw invalido(campo, `${nombre} es obligatorio.`);
    }
    // Cuenta caracteres (code points), como char_length en Postgres. Con
    // .length un emoji contaría como 2.
    if (Array.from(recortado).length > max) {
      throw invalido(
        campo,
        `${nombre} no puede superar los ${max} caracteres.`,
      );
    }
    return recortado;
  }

  /** La referencia es opcional; si viene, tipo e id son obligatorios. */
  private validarReferencia(valor: unknown): AvisoNormalizado['referencia'] {
    if (valor === undefined || valor === null) return null;
    if (typeof valor !== 'object') {
      throw invalido(
        'referencia',
        'La referencia debe ser un objeto { tipo, id }.',
      );
    }

    const { tipo, id } = valor as Record<string, unknown>;
    const tipoRecortado = texto(tipo);
    if (!tipoRecortado) {
      throw invalido('referencia.tipo', 'La referencia debe incluir el tipo.');
    }
    const idRecortado = texto(id);
    if (!idRecortado) {
      throw invalido('referencia.id', 'La referencia debe incluir el id.');
    }
    return { tipo: tipoRecortado, id: idRecortado };
  }
}

/** El valor recortado si es un string con contenido; si no, cadena vacía. */
function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function invalido(campo: CampoAviso, mensaje: string): AvisoInvalidoError {
  return new AvisoInvalidoError(campo, mensaje);
}
