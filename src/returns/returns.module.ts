import { Module } from '@nestjs/common';
import { NotificationsModule } from '@Notifications';
import {
  DepositResolutionsController,
  ReturnsController,
} from '@Returns/controllers';
import {
  DepositResolutionRepository,
  ReturnRepository,
} from '@Returns/repositories';
import { DepositResolutionsService, ReturnsService } from '@Returns/services';

/**
 * Módulo 4 (H09): devolución del equipo o fin del uso del espacio y
 * resolución de la garantía. Al resolver, la reserva pasa de EN_CURSO a
 * COMPLETADA en una sola transacción y se avisa al arrendatario.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [ReturnsController, DepositResolutionsController],
  providers: [
    ReturnsService,
    ReturnRepository,
    DepositResolutionsService,
    DepositResolutionRepository,
  ],
})
export class ReturnsModule {}
