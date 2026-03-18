import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { MemberRole } from '@prisma/client';

export interface JwtPayload {
  sub: number;
  isSuperAdmin: boolean;
  cineClubId?: number;
  role?: MemberRole;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'fallback-dev-secret',
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    // Coerce sub to number to handle legacy tokens that had sub as a string
    return { ...payload, sub: Number(payload.sub) };
  }
}
