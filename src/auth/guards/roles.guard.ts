import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type { RequestWithUser } from '../decorators/current-user.decorator.js';
import type { UserRole } from '@PrismaClient';

/**
 * Guard global de roles. Corre después de JwtAuthGuard, así que el usuario ya
 * viene cargado desde la base en cada request: el rol que se revisa es el de
 * la base, nunca uno que mande el cliente ni uno guardado en el token.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles || roles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<RequestWithUser>();
    if (!user || !roles.includes(user.role)) {
      throw new ForbiddenException(
        'Tu cuenta no tiene permiso para esta acción.',
      );
    }
    return true;
  }
}
