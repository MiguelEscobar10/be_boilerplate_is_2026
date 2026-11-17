import { Module } from '@nestjs/common';
import { DeliveriesController } from '@Deliveries/controllers';
import { DeliveryRepository } from '@Deliveries/repositories';
import {
  DeliveriesService,
  DeliveryPhotoStorageService,
} from '@Deliveries/services';

/**
 * Módulo 4 (H08): entrega del equipo o espacio. Registra la entrega y pasa la
 * reserva de CONFIRMADA a EN_CURSO en una sola transacción.
 */
@Module({
  controllers: [DeliveriesController],
  providers: [
    DeliveriesService,
    DeliveryRepository,
    DeliveryPhotoStorageService,
  ],
})
export class DeliveriesModule {}
