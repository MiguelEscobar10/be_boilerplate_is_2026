import { Module } from '@nestjs/common';
import { TenantRatingsController } from '@TenantRatings/controllers';
import { TenantRatingRepository } from '@TenantRatings/repositories';
import { TenantRatingsService } from '@TenantRatings/services';

/**
 * Calificación del arrendatario (Módulo 6, H18): el arrendador califica a
 * quien alquiló su bien cuando la reserva termina.
 */
@Module({
  controllers: [TenantRatingsController],
  providers: [TenantRatingsService, TenantRatingRepository],
})
export class TenantRatingsModule {}
