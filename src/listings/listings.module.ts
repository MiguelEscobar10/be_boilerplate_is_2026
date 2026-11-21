import { Module } from '@nestjs/common';
import { ListingsController } from '@Listings/controllers';
import { ListingRepository } from '@Listings/repositories';
import { ImageStorageService, ListingsService } from '@Listings/services';
import { ListingRatingsModule } from '@ListingRatings';

@Module({
  // Los promedios del detalle (H12) salen del módulo de calificaciones (H17).
  imports: [ListingRatingsModule],
  controllers: [ListingsController],
  providers: [ListingsService, ListingRepository, ImageStorageService],
  // H02, H12 y H03 van a leer publicaciones desde sus propios módulos.
  exports: [ListingsService, ListingRepository],
})
export class ListingsModule {}
