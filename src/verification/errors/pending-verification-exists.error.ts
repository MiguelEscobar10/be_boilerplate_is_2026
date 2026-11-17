/**
 * Error de dominio: el usuario ya tiene una solicitud de verificación
 * PENDIENTE (H07).
 *
 * Lo lanza el repositorio al chocar con el índice único parcial
 * `identity_verifications_one_pending_per_user_key`, y el servicio lo traduce
 * a 409. Así el servicio no necesita conocer los códigos de error de Prisma.
 */
export class PendingVerificationExistsError extends Error {
  constructor(public readonly userId: string) {
    super('El usuario ya tiene una solicitud de verificación PENDIENTE.');
    this.name = 'PendingVerificationExistsError';
  }
}
