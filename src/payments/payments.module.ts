import { Module } from '@nestjs/common';
import { NotificationsModule } from '@Notifications';
import { PagosController } from '@Payments/controllers';
import { PagoRepository } from '@Payments/repositories';
import {
  PASARELA_CONFIG,
  PagosService,
  PasarelaSimuladaService,
  RETARDO_PASARELA_MS,
  type PasarelaConfig,
} from '@Payments/services';

/**
 * Módulo 4: Pagos simulados y garantía (H05). Avisa por medio del Módulo 8.
 * Ver docs/modulos/pagos.md.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [PagosController],
  providers: [
    PagosService,
    PasarelaSimuladaService,
    PagoRepository,
    {
      provide: PASARELA_CONFIG,
      useValue: { retardoMs: RETARDO_PASARELA_MS } satisfies PasarelaConfig,
    },
  ],
})
export class PaymentsModule {}
