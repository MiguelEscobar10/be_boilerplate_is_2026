import { Module } from '@nestjs/common';
import {
  ListingVerificationController,
  ReviewController,
  VerificationController,
} from '@Verification/controllers';
import {
  IdentityVerificationRepository,
  VerificationRequirementRepository,
} from '@Verification/repositories';
import {
  DocumentStorageService,
  ReviewService,
  VerificationRequirementService,
  VerificationService,
} from '@Verification/services';

/**
 * Módulo 7: Verificación de identidad y documentos.
 *
 * - VerificationController (BE-07.1): envío y consulta de la solicitud propia.
 * - ReviewController (BE-07.2): cola, documento y decisión del REVISOR.
 * - ListingVerificationController (BE-19.1): opción "requiere verificación".
 * - Exporta VerificationRequirementService: BE-03.1 (reservas) importa este
 *   módulo y llama a `exigeVerificacionYNoCumple` al registrar una solicitud.
 */
@Module({
  controllers: [
    VerificationController,
    ReviewController,
    ListingVerificationController,
  ],
  providers: [
    VerificationService,
    ReviewService,
    IdentityVerificationRepository,
    DocumentStorageService,
    VerificationRequirementService,
    VerificationRequirementRepository,
  ],
  exports: [IdentityVerificationRepository, VerificationRequirementService],
})
export class VerificationModule {}
