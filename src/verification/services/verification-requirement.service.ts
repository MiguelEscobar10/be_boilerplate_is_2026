import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  VerificationRequirementRepository,
  type ListingRequirement,
} from '@Verification/repositories';

/**
 * Opción "requiere verificación" de una publicación y la regla que la hace
 * cumplir al reservar (H19, BE-19.1).
 */
@Injectable()
export class VerificationRequirementService {
  constructor(
    private readonly requirements: VerificationRequirementRepository,
  ) {}

  /**
   * Activa o desactiva la opción. Solo el dueño de la publicación.
   *
   * @throws {NotFoundException} si la publicación no existe.
   * @throws {ForbiddenException} si quien la cambia no es el dueño.
   */
  async setRequiresVerification(
    listingId: string,
    userId: string,
    requiresVerification: boolean,
  ): Promise<ListingRequirement> {
    const listing = await this.requirements.findListing(listingId);
    if (!listing) {
      throw new NotFoundException('La publicación no existe.');
    }
    if (listing.landlordId !== userId) {
      throw new ForbiddenException(
        'Solo el dueño de la publicación puede cambiar esta opción.',
      );
    }
    if (listing.requiresVerification === requiresVerification) {
      return listing;
    }
    return this.requirements.setRequiresVerification(
      listingId,
      requiresVerification,
    );
  }

  /**
   * `true` si la publicación exige verificación y el arrendatario no tiene una
   * verificación APROBADA: en ese caso BE-03.1 no registra la solicitud y
   * responde `422 VERIFICACION_REQUERIDA` (ver VerificacionRequeridaException).
   *
   * `false` si la publicación no la exige, si el arrendatario está verificado
   * o si la publicación no existe (ese 404 lo decide BE-03.1, no esta regla).
   */
  async exigeVerificacionYNoCumple(
    publicacionId: string,
    arrendatarioId: string,
  ): Promise<boolean> {
    const listing = await this.requirements.findListing(publicacionId);
    if (!listing?.requiresVerification) return false;
    return !(await this.requirements.hasApprovedVerification(arrendatarioId));
  }
}
