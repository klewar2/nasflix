import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MemberRole } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';
import { JwtPayload } from '../strategies/jwt.strategy';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredRoles = this.reflector.getAllAndOverride<MemberRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) return true;

    const user: JwtPayload = context.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('Non authentifié');

    // SuperAdmin bypasses all role checks
    if (user.isSuperAdmin) return true;

    if (!user.role) throw new ForbiddenException('Aucun CineClub sélectionné');

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Droits insuffisants');
    }

    return true;
  }
}
