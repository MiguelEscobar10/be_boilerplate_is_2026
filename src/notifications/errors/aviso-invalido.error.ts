import type { CampoAviso } from '@Notifications/types';

/**
 * El aviso no cumple el contrato del servicio de avisos y no se registró.
 *
 * Es un error interno, no una excepción HTTP: el servicio de avisos no es un
 * endpoint, así que cada módulo que llama decide qué hacer con él.
 */
export class AvisoInvalidoError extends Error {
  readonly codigo = 'AVISO_INVALIDO';

  constructor(
    public readonly campo: CampoAviso,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'AvisoInvalidoError';
  }
}
