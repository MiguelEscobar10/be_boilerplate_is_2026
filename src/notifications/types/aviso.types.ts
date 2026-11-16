import { ModuloOrigen } from '@PrismaClient';

/**
 * Se reexporta para que los demás módulos importen el enum desde el servicio de
 * avisos en lugar de repetir la lista.
 */
export { ModuloOrigen };

/** Referencia opcional a la entidad que originó el aviso (p. ej. una reserva). */
export interface ReferenciaAviso {
  /** Tipo de la entidad, p. ej. `reserva` o `pago`. */
  tipo: string;
  /** Identificador de la entidad. */
  id: string;
}

/**
 * Aviso que un módulo del backend le pide registrar al servicio de avisos.
 *
 * Datos sensibles: `titulo` y `mensaje` nunca deben incluir números de tarjeta,
 * códigos de seguridad, números de documentos (DUI, NIT, pasaporte) ni
 * contraseñas. Los importes sí se permiten (p. ej. el monto total de un pago,
 * como pide H05). El servicio no puede verificarlo: lo garantiza quien llama.
 */
export interface Aviso {
  /** UUID del usuario destinatario. Debe existir. */
  destinatarioId: string;
  /** De 1 a 100 caracteres, sin contar los espacios de los extremos. */
  titulo: string;
  /** De 1 a 500 caracteres, sin contar los espacios de los extremos. */
  mensaje: string;
  /** Módulo que origina el aviso. */
  moduloOrigen: ModuloOrigen;
  /** Opcional. Si viene, `tipo` e `id` son obligatorios. */
  referencia?: ReferenciaAviso | null;
}

/** Resultado de `notificar`: el id del aviso registrado (o del que ya existía). */
export interface AvisoRegistrado {
  id: string;
}

/** Campo del aviso que no cumple el contrato. */
export type CampoAviso =
  | 'destinatarioId'
  | 'titulo'
  | 'mensaje'
  | 'moduloOrigen'
  | 'referencia'
  | 'referencia.tipo'
  | 'referencia.id';
