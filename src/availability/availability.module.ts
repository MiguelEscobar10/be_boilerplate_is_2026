import { Module } from '@nestjs/common';
import { ListingsModule } from '@Listings';
import { AvailabilityController } from '@Availability/controllers';
import { AvailabilityRepository } from '@Availability/repositories';
import { AvailabilityService } from '@Availability/services';

/**
 * Disponibilidad de una publicación (Módulo 3): el calendario de días
 * ocupados (H13). Los bloqueos de fechas del arrendador (H14, BE-14.1) van a
 * vivir también aquí.
 */
@Module({
  // ListingsService resuelve el 404 de una publicación inactiva o inexistente.
  imports: [ListingsModule],
  controllers: [AvailabilityController],
  providers: [AvailabilityService, AvailabilityRepository],
})
export class AvailabilityModule {}
