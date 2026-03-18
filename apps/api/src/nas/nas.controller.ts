import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { NasService } from './nas.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

@Controller('nas')
@UseGuards(RolesGuard)
export class NasController {
  constructor(private readonly nasService: NasService) {}

  @Get('status')
  async getStatus(@Req() req: { user: JwtPayload }) {
    if (!req.user.cineClubId) return { online: false, lastCheckedAt: new Date().toISOString() };

    const online = await this.nasService.checkStatusForCineClub(req.user.cineClubId);
    return { online, lastCheckedAt: new Date().toISOString() };
  }
}
