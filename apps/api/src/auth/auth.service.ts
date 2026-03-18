import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma.service';
import { MemberRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) throw new UnauthorizedException('Identifiants invalides');

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) throw new UnauthorizedException('Identifiants invalides');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const payload: JwtPayload = { sub: user.id, isSuperAdmin: user.isSuperAdmin };
    return {
      accessToken: this.signToken(payload),
      refreshToken: this.signRefreshToken(payload),
      user: this.formatUser(user),
    };
  }

  async getMe(userId: number) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.formatUser(user);
  }

  async getMyCineClubs(userId: number, isSuperAdmin: boolean) {
    if (isSuperAdmin) {
      const clubs = await this.prisma.cineClub.findMany({ orderBy: { name: 'asc' } });
      return clubs.map((c) => ({ ...c, role: MemberRole.ADMIN }));
    }

    const memberships = await this.prisma.cineClubMember.findMany({
      where: { userId },
      include: { cineClub: true },
      orderBy: { cineClub: { name: 'asc' } },
    });

    return memberships.map((m) => ({ ...m.cineClub, role: m.role }));
  }

  async selectCineClub(userId: number, isSuperAdmin: boolean, cineClubId: number) {
    let role: MemberRole;

    if (isSuperAdmin) {
      const club = await this.prisma.cineClub.findUnique({ where: { id: cineClubId } });
      if (!club) throw new ForbiddenException('CineClub introuvable');
      role = MemberRole.ADMIN;
    } else {
      const membership = await this.prisma.cineClubMember.findUnique({
        where: { userId_cineClubId: { userId, cineClubId } },
      });
      if (!membership) throw new ForbiddenException('Accès refusé à ce CineClub');
      role = membership.role;
    }

    const payload: JwtPayload = { sub: userId, isSuperAdmin, cineClubId, role };
    return {
      accessToken: this.signToken(payload),
      refreshToken: this.signRefreshToken(payload),
    };
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
      const newPayload: JwtPayload = {
        sub: payload.sub,
        isSuperAdmin: payload.isSuperAdmin,
        ...(payload.cineClubId !== undefined && { cineClubId: payload.cineClubId }),
        ...(payload.role !== undefined && { role: payload.role }),
      };
      return {
        accessToken: this.signToken(newPayload),
        refreshToken: this.signRefreshToken(newPayload),
      };
    } catch {
      throw new UnauthorizedException('Token de rafraîchissement invalide');
    }
  }

  private signToken(payload: JwtPayload): string {
    return this.jwtService.sign(payload);
  }

  private signRefreshToken(payload: JwtPayload): string {
    return this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: '7d',
    });
  }

  private formatUser(user: { id: number; username: string; firstName: string; lastName: string; isSuperAdmin: boolean; lastLoginAt: Date | null }) {
    return {
      id: user.id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      isSuperAdmin: user.isSuperAdmin,
      lastLoginAt: user.lastLoginAt,
    };
  }
}
