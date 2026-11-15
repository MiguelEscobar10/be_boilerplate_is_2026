import { ApiProperty } from '@nestjs/swagger';
import { UserRole, type User, type UserProfile } from '@PrismaClient';

/**
 * Forma pública de un usuario.
 *
 * Los controladores devuelven esto y nunca la fila cruda de Prisma, para que
 * `passwordHash` no pueda filtrarse en una respuesta por descuido.
 */
export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'nestor@example.com', format: 'email' })
  email!: string;

  @ApiProperty({ enum: UserRole })
  rol!: UserRole;

  @ApiProperty({ type: String, nullable: true, example: 'Lee Fuentes' })
  nombre!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '70001234' })
  telefono!: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  static fromEntity(
    user: User & { profile?: UserProfile | null },
  ): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      rol: user.role,
      // Las cuentas creadas antes del Módulo 0 (p. ej. el demo) no tienen perfil.
      nombre: user.profile?.name ?? null,
      telefono: user.profile?.phone ?? null,
      isActive: user.isActive,
      createdAt: user.createdAt,
    };
  }
}
