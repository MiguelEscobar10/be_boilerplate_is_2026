import { UnprocessableEntityException } from '@nestjs/common';

export const VERIFICACION_REQUERIDA = 'VERIFICACION_REQUERIDA';

export const VERIFICACION_REQUERIDA_MENSAJE =
  'Esta publicación solo acepta usuarios verificados. Envía tu documento de identidad para verificarte.';

/**
 * 422 que responde BE-03.1 cuando la publicación exige verificación y el
 * arrendatario no la tiene (H19). Lleva `codigo` además del formato de Nest
 * para que el frontend (FE-19.1) reconozca este caso y muestre el enlace a la
 * pantalla de verificación sin depender del texto del mensaje.
 *
 *   if (await requisito.exigeVerificacionYNoCumple(publicacionId, arrendatarioId)) {
 *     throw new VerificacionRequeridaException();
 *   }
 */
export class VerificacionRequeridaException extends UnprocessableEntityException {
  constructor() {
    super({
      statusCode: 422,
      error: 'Unprocessable Entity',
      codigo: VERIFICACION_REQUERIDA,
      message: VERIFICACION_REQUERIDA_MENSAJE,
    });
  }
}
