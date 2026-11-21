import { Module } from '@nestjs/common';
import { NotificationsModule } from '@Notifications';
import { VerificationModule } from '@Verification';
import { ReservationsController } from '@Reservations/controllers';
import { ReservationsRepository } from '@Reservations/repositories';
import { ReservationsService } from '@Reservations/services';

/**
 * Solicitud y consulta de reservas (Módulo 3, H03): el arrendatario pide un
 * período, el servidor calcula el costo y guarda la solicitud PENDIENTE sin
 * apartar fechas, y avisa al arrendador por medio del Módulo 8. Aplica la
 * regla "requiere verificación" del Módulo 7 (H19).
 *
 * La decisión del arrendador (H04) vive en `ReservationDecisionsModule`.
 */
@Module({
  imports: [NotificationsModule, VerificationModule],
  controllers: [ReservationsController],
  providers: [ReservationsService, ReservationsRepository],
})
export class ReservationsModule {}
