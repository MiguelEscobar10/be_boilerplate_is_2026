import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard.js';
import type { UserRole } from '@PrismaClient';

/** Contexto mínimo: solo lo que el guard lee (handler, clase y request.user). */
function contextWith(user?: { role: UserRole }): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);
  const requireRoles = (roles?: UserRole[]) =>
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(roles);

  afterEach(() => vi.restoreAllMocks());

  it('deja pasar una ruta sin @Roles', () => {
    requireRoles(undefined);
    expect(guard.canActivate(contextWith({ role: 'ARRENDATARIO' }))).toBe(true);
  });

  it('deja pasar si el rol del usuario está permitido', () => {
    requireRoles(['ARRENDADOR']);
    expect(guard.canActivate(contextWith({ role: 'ARRENDADOR' }))).toBe(true);
  });

  it('acepta cualquiera de varios roles', () => {
    requireRoles(['ARRENDADOR', 'ARRENDATARIO']);
    expect(guard.canActivate(contextWith({ role: 'ARRENDATARIO' }))).toBe(true);
  });

  it('responde 403 si el rol no está permitido', () => {
    requireRoles(['ARRENDADOR']);
    expect(() =>
      guard.canActivate(contextWith({ role: 'ARRENDATARIO' })),
    ).toThrow(ForbiddenException);
  });

  it('responde 403 si no hay usuario en el request', () => {
    requireRoles(['REVISOR']);
    expect(() => guard.canActivate(contextWith(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
