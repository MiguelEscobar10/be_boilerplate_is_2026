import { Module } from '@nestjs/common';
import {
  ListingVerificationController,
  VerificationController,
} from '@Verification/controllers';
import {
  IdentityVerificationRepository,
  VerificationRequirementRepository,
} from '@Verification/repositories';
import {
  DocumentStorageService,
  VerificationRequirementService,
  VerificationService,
} from '@Verification/services';

/**
 * Módulo 7: Verificación de identidad y documentos.
 *
 * - VerificationController (BE-07.1): envío y consulta de la solicitud propia.
 * - ListingVerificationController (BE-19.1): opción "requiere verificación".
 * - Exporta VerificationRequirementService: BE-03.1 (reservas) importa este
 *   módulo y llama a `exigeVerificacionYNoCumple` al registrar una solicitud.
 */
@Module({
  controllers: [VerificationController, ListingVerificationController],
  providers: [
    VerificationService,
    IdentityVerificationRepository,
    DocumentStorageService,
    VerificationRequirementService,
    VerificationRequirementRepository,
  ],
  exports: [IdentityVerificationRepository, VerificationRequirementService],
})
export class VerificationModule {}
