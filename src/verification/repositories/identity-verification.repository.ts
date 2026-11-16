import { Injectable } from '@nestjs/common';
import { PrismaService } from '@Prisma/services';
import { PendingVerificationExistsError } from '@Verification/errors';
import { Prisma, type IdentityVerification } from '@PrismaClient';

/** Código de Prisma para violación de restricción única. */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/** Único punto del módulo que habla con `identity_verifications`. */
@Injectable()
export class IdentityVerificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra una solicitud nueva en PENDIENTE.
   *
   * @throws {PendingVerificationExistsError} si el usuario ya tiene una
   * PENDIENTE. Lo decide el índice único parcial de la base y no una consulta
   * previa, para que dos envíos simultáneos no registren dos pendientes.
   */
  async create(
    userId: string,
    documentKey: string,
  ): Promise<IdentityVerification> {
    try {
      return await this.prisma.identityVerification.create({
        data: { userId, documentKey },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new PendingVerificationExistsError(userId);
      }
      throw error;
    }
  }

  /** La solicitud más reciente del usuario, o null si nunca envió una. */
  findLatestByUser(userId: string): Promise<IdentityVerification | null> {
    return this.prisma.identityVerification.findFirst({
      where: { userId },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
    });
  }

  async hasPending(userId: string): Promise<boolean> {
    const count = await this.prisma.identityVerification.count({
      where: { userId, status: 'PENDIENTE' },
    });
    return count > 0;
  }
}
