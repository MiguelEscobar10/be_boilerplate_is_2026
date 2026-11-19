/**
 * Error de dominio: la reserva ya no admite devolución (otra petición la
 * registró o cambió de estado entre la lectura y la transacción). El servicio
 * lo traduce a 409.
 */
export class ReturnConflictError extends Error {
  constructor(public readonly reason: 'YA_DEVUELTA' | 'NO_EN_CURSO') {
    super(
      reason === 'YA_DEVUELTA'
        ? 'La reserva ya tiene una devolución registrada.'
        : 'La reserva no está EN_CURSO.',
    );
    this.name = 'ReturnConflictError';
  }
}
