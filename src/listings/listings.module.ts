import { Module } from '@nestjs/common';
import { ListingsController } from '@Listings/controllers';
import { ListingRepository } from '@Listings/repositories';
import { ImageStorageService, ListingsService } from '@Listings/services';

@Module({
  controllers: [ListingsController],
  providers: [ListingsService, ListingRepository, ImageStorageService],
  // H02, H12 y H03 van a leer publicaciones desde sus propios módulos.
  exports: [ListingsService, ListingRepository],
})
export class ListingsModule {}
