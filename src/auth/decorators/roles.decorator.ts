import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@PrismaClient';

export const ROLES_KEY = 'roles';

/**
 * Limita una ruta (o un controller entero) a ciertos roles.
 *
 *   @Roles('ARRENDADOR')
 *   @Post()
 *   create() { ... }
 *
 * Sin sesión responde 401 (lo hace JwtAuthGuard antes); con sesión pero con
 * otro rol responde 403. Las rutas sin @Roles solo exigen sesión.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
