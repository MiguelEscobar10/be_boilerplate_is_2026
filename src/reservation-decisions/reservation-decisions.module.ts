import { Module } from '@nestjs/common';
import { NotificationsModule } from '@Notifications';
import {
  LandlordRequestsController,
  ReservationDecisionController,
} from '@ReservationDecisions/controllers';
import { ReservationDecisionRepository } from '@ReservationDecisions/repositories';
import { ReservationDecisionsService } from '@ReservationDecisions/services';

/**
 * Aprobación y rechazo de solicitudes de reserva (Módulo 3, H04): el panel
 * "Mis solicitudes" del arrendador y la decisión con control de concurrencia.
 * Avisa al arrendatario por medio del Módulo 8.
 *
 * Es un módulo aparte del de solicitar reservas (BE-03.1) para que los dos se
 * puedan trabajar y mergear sin tocarse.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [LandlordRequestsController, ReservationDecisionController],
  providers: [ReservationDecisionsService, ReservationDecisionRepository],
})
export class ReservationDecisionsModule {}
