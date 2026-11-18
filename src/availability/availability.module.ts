import { Module } from '@nestjs/common';
import { ListingsModule } from '@Listings';
import {
  AvailabilityController,
  BlocksController,
} from '@Availability/controllers';
import {
  AvailabilityRepository,
  BlockRepository,
} from '@Availability/repositories';
import { AvailabilityService, BlocksService } from '@Availability/services';

/**
 * Disponibilidad de una publicación (Módulo 3): el calendario de días
 * ocupados (H13) y los bloqueos de fechas del arrendador (H14).
 */
@Module({
  // ListingsService resuelve el 404 de una publicación inactiva o inexistente.
  imports: [ListingsModule],
  controllers: [AvailabilityController, BlocksController],
  providers: [
    AvailabilityService,
    AvailabilityRepository,
    BlocksService,
    BlockRepository,
  ],
})
export class AvailabilityModule {}
