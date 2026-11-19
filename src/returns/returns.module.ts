import { Module } from '@nestjs/common';
import { ReturnsController } from '@Returns/controllers';
import { ReturnRepository } from '@Returns/repositories';
import { ReturnsService } from '@Returns/services';

/**
 * Módulo 4 (H09): devolución del equipo o fin del uso del espacio. Registra
 * la devolución de una reserva EN_CURSO; la garantía se resuelve después.
 */
@Module({
  controllers: [ReturnsController],
  providers: [ReturnsService, ReturnRepository],
})
export class ReturnsModule {}
