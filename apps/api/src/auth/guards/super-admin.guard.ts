import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { JwtPayload } from '../strategies/jwt.strategy';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user: JwtPayload | undefined = context.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('Non authentifié');
    if (!user.isSuperAdmin) throw new ForbiddenException('Réservé aux super admins');
    return true;
  }
}
