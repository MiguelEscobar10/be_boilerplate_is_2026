import { Module } from '@nestjs/common';
import { VerificationController } from '@Verification/controllers';
import { IdentityVerificationRepository } from '@Verification/repositories';
import {
  DocumentStorageService,
  VerificationService,
} from '@Verification/services';

/**
 * Módulo 7: Verificación de identidad y documentos.
 *
 * - VerificationController (BE-07.1): envío y consulta de la solicitud propia.
 * - El repositorio se exporta porque H19 (BE-19.1) consulta si un usuario está
 *   verificado.
 */
@Module({
  controllers: [VerificationController],
  providers: [
    VerificationService,
    IdentityVerificationRepository,
    DocumentStorageService,
  ],
  exports: [IdentityVerificationRepository],
})
export class VerificationModule {}
