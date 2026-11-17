import { Injectable } from '@nestjs/common';
import { PrismaService } from '@Prisma/services';

export interface ListingRequirement {
  id: string;
  landlordId: string;
  requiresVerification: boolean;
}

/**
 * Lecturas y la única escritura de la opción "requiere verificación" (H19).
 *
 * Toca solo `listings.requires_verification`; el resto de la publicación es
 * de BE-01.1. "Verificado" se consulta en `identity_verifications` (DB-07.1):
 * no se guarda en otro lado.
 */
@Injectable()
export class VerificationRequirementRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** La publicación con su dueño y la opción, aunque esté desactivada. */
  findListing(listingId: string): Promise<ListingRequirement | null> {
    return this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, landlordId: true, requiresVerification: true },
    });
  }

  setRequiresVerification(
    listingId: string,
    requiresVerification: boolean,
  ): Promise<ListingRequirement> {
    return this.prisma.listing.update({
      where: { id: listingId },
      data: { requiresVerification },
      select: { id: true, landlordId: true, requiresVerification: true },
    });
  }

  /** Verificado = tiene alguna verificación APROBADA (DB-19.1). */
  async hasApprovedVerification(userId: string): Promise<boolean> {
    const count = await this.prisma.identityVerification.count({
      where: { userId, status: 'APROBADA' },
    });
    return count > 0;
  }
}
