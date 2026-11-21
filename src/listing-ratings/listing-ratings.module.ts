import { Module } from '@nestjs/common';
import { ListingRatingsController } from '@ListingRatings/controllers';
import { ListingRatingRepository } from '@ListingRatings/repositories';
import { ListingRatingsService } from '@ListingRatings/services';

/**
 * Calificación del bien y del arrendador (Módulo 6, H17): el arrendatario
 * califica cuando la reserva termina. Exporta el servicio para que el detalle
 * de la publicación (BE-12.1) use `promedioCalificaciones`.
 */
@Module({
  controllers: [ListingRatingsController],
  providers: [ListingRatingsService, ListingRatingRepository],
  exports: [ListingRatingsService],
})
export class ListingRatingsModule {}
