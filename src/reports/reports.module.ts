import { Module } from '@nestjs/common';
import { ReportsController } from '@Reports/controllers';
import { OccupancyRepository } from '@Reports/repositories';
import { ReportsService } from '@Reports/services';

/**
 * Módulo de reportes del arrendador (H22). Por ahora, la tasa de ocupación
 * sobre la consulta de días ocupados y bloqueados de DB-22.1.
 */
@Module({
  controllers: [ReportsController],
  providers: [ReportsService, OccupancyRepository],
})
export class ReportsModule {}
