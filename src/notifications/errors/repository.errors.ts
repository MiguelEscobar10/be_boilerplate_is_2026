/**
 * Errores internos de NotificationRepository. Traducen los códigos de Prisma
 * para que AvisosService no tenga que conocerlos. No salen del módulo.
 */

/** Ya existe un aviso con el mismo destinatario, módulo, referencia y título. */
export class AvisoDuplicadoError extends Error {
  constructor() {
    super('Ya existe un aviso con el mismo destinatario, módulo, referencia y título.');
    this.name = 'AvisoDuplicadoError';
  }
}

/** El destinatario no existe (violación de la FK a `users`). */
export class DestinatarioInexistenteError extends Error {
  constructor() {
    super('El destinatario no existe.');
    this.name = 'DestinatarioInexistenteError';
  }
}
