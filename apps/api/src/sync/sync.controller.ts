import { Controller, Post, Get, Param, Query, ParseIntPipe, DefaultValuePipe, Headers, Body, UnauthorizedException, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { SyncService } from './sync.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma.service';
import { Public } from '../auth/guards/public.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { MemberRole } from '@prisma/client';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

@Controller('sync')
@UseGuards(RolesGuard)
@Roles(MemberRole.ADMIN)
export class SyncController {
  constructor(
    private readonly syncService: SyncService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('full')
  async fullSync(@Req() req: { user: JwtPayload }) {
    const { cineClubId, nasUsername, nasPassword } = await this.getMemberNasCredentials(req.user);
    return this.syncService.fullSync(cineClubId, nasUsername, nasPassword, 'manual');
  }

  @Post('pending')
  async enqueuePending(@Req() req: { user: JwtPayload }) {
    const cineClubId = this.requireCineClub(req.user);
    const queued = await this.syncService.enqueuePendingMetadata(cineClubId);
    return { message: `${queued} job(s) enqueued`, queued };
  }

  @Post('drain')
  async drainQueue() {
    return this.syncService.drainQueue();
  }

  @Post('media/:id')
  async syncSingleMedia(@Param('id', ParseIntPipe) id: number, @Req() req: { user: JwtPayload }) {
    const cineClubId = this.requireCineClub(req.user);
    const result = await this.syncService.syncSingleMedia(id, cineClubId, { ignoreTmdbId: true });
    return { message: 'Sync terminée', ...result };
  }

  @Get('logs')
  async getLogs(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Req() req: { user: JwtPayload },
  ) {
    const cineClubId = this.requireCineClub(req.user);
    return this.syncService.getSyncLogs(cineClubId, page, limit);
  }

  @Public()
  @Post('webhook')
  async webhook(
    @Headers('x-sync-secret') secret: string,
    @Headers('x-cineclubid') cineClubIdHeader: string,
    @Body() body: { added?: string[]; removed?: string[]; moved?: Array<{ from: string; to: string }> },
  ) {
    const expectedSecret = this.configService.get<string>('SYNC_WEBHOOK_SECRET');
    if (!expectedSecret || secret !== expectedSecret) {
      throw new UnauthorizedException('Webhook secret invalide');
    }
    const cineClubId = parseInt(cineClubIdHeader, 10);
    if (!cineClubId) throw new ForbiddenException('X-CineClubId header manquant');

    const hasDiff = (body?.added?.length ?? 0) + (body?.removed?.length ?? 0) + (body?.moved?.length ?? 0) > 0;
    if (hasDiff) {
      this.syncService.diffSync(cineClubId, body).catch((err) => console.error('Webhook diff sync failed:', err));
    } else {
      // For webhook full sync, we need NAS credentials — just enqueue pending metadata
      this.syncService.enqueuePendingMetadata(cineClubId).catch((err) => console.error('Webhook sync failed:', err));
    }

    return { message: 'Sync déclenchée' };
  }

  private requireCineClub(user: JwtPayload): number {
    if (!user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    return user.cineClubId;
  }

  private async getMemberNasCredentials(user: JwtPayload): Promise<{ cineClubId: number; nasUsername: string; nasPassword: string }> {
    const cineClubId = this.requireCineClub(user);

    const club = await this.prisma.cineClub.findUniqueOrThrow({ where: { id: cineClubId } });
    if (!club.nasBaseUrl) throw new ForbiddenException('NAS non configuré pour ce CineClub');

    const membership = await this.prisma.cineClubMember.findUnique({
      where: { userId_cineClubId: { userId: user.sub, cineClubId } },
    });
    if (!membership?.nasUsername || !membership?.nasPassword) {
      throw new ForbiddenException('Identifiants NAS non configurés pour votre compte');
    }
    return { cineClubId, nasUsername: membership.nasUsername, nasPassword: membership.nasPassword };
  }
}
