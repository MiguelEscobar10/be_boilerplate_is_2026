import { Module } from '@nestjs/common';
import { IncomeController } from '@Income/controllers';
import { IncomeRepository } from '@Income/repositories';
import { Clock, IncomeService, SystemClock } from '@Income/services';

/**
 * Reporte de ingresos del arrendador (H21, BE-21.1) sobre la función
 * `listing_income` de DB-21.1. Ver docs/modulos/ingresos.md.
 *
 * El reloj va como provider para que las pruebas fijen el "mes en curso".
 */
@Module({
  controllers: [IncomeController],
  providers: [
    IncomeService,
    IncomeRepository,
    { provide: Clock, useClass: SystemClock },
  ],
})
export class IncomeModule {}
