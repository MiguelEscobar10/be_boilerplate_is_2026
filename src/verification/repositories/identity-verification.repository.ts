import { Injectable } from '@nestjs/common';
import { PrismaService } from '@Prisma/services';
import { PendingVerificationExistsError } from '@Verification/errors';
import {
  Prisma,
  type IdentityVerification,
  type IdentityVerificationStatus,
} from '@PrismaClient';

/** Código de Prisma para violación de restricción única. */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/** Solicitud con los datos del solicitante que ve el REVISOR. */
export type VerificationWithApplicant = IdentityVerification & {
  user: { id: string; email: string; profile: { name: string } | null };
};

export interface DecisionData {
  status: Exclude<IdentityVerificationStatus, 'PENDIENTE'>;
  reviewedById: string;
  rejectionReason: string | null;
}

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

  /** Solicitudes de un estado, en orden de llegada (cola del REVISOR). */
  findByStatus(
    status: IdentityVerificationStatus,
  ): Promise<VerificationWithApplicant[]> {
    return this.prisma.identityVerification.findMany({
      where: { status },
      orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
      include: {
        user: {
          select: {
            id: true,
            email: true,
            profile: { select: { name: true } },
          },
        },
      },
    });
  }

  findById(id: string): Promise<IdentityVerification | null> {
    return this.prisma.identityVerification.findUnique({ where: { id } });
  }

  /**
   * Registra la decisión solo si la solicitud sigue PENDIENTE, en un único
   * UPDATE: dos decisiones simultáneas no pueden pisarse.
   *
   * `reviewedAt` nunca queda antes del envío (CHECK de DB-07.1), aunque el
   * reloj de la aplicación vaya unos milisegundos atrás del de la base.
   *
   * @returns la solicitud decidida, o `null` si ya no estaba PENDIENTE.
   */
  async decide(
    verification: IdentityVerification,
    { status, reviewedById, rejectionReason }: DecisionData,
  ): Promise<IdentityVerification | null> {
    const now = new Date();
    const reviewedAt =
      now < verification.submittedAt ? verification.submittedAt : now;

    const [decided] =
      await this.prisma.identityVerification.updateManyAndReturn({
        where: { id: verification.id, status: 'PENDIENTE' },
        data: { status, reviewedById, reviewedAt, rejectionReason },
      });
    return decided ?? null;
  }
}
