import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  Headers,
  Body,
  UnauthorizedException,
  Req,
  UseGuards,
  ForbiddenException,
  Logger
} from '@nestjs/common';
import { SyncService } from './sync.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma.service';
import { SyncGateway } from './sync.gateway';
import { Public } from '../auth/guards/public.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { MemberRole } from '@prisma/client';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

@Controller('sync')
@UseGuards(RolesGuard)
@Roles(MemberRole.ADMIN)
export class SyncController {
  private readonly logger = new Logger(SyncController.name);

  constructor(
    private readonly syncService: SyncService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly syncGateway: SyncGateway,
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

  @Post('jellyfin')
  async syncJellyfin(@Req() req: { user: JwtPayload }) {
    const cineClubId = this.requireCineClub(req.user);
    return this.syncService.syncFromJellyfin(cineClubId);
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
    @Body() body: { trigger?: string; added?: string[]; removed?: string[]; moved?: Array<{ from: string; to: string }> },
  ) {
    // Résolution du CineClub : 1) par webhookSecret en DB (auto-identifiant, pas de header requis)
    //                           2) fallback legacy : env var global + header x-cineclubid
    let cineClubId: number;

    this.logger.log(`Webhook received secret: ${secret}`);
    const clubBySecret = secret
      ? await this.prisma.cineClub.findUnique({ where: { webhookSecret: secret } })
      : null;

    this.logger.log(`clubBySecret: ${clubBySecret?.id}`);

    if (clubBySecret) {
      cineClubId = clubBySecret.id;
    } else {
      // Fallback legacy pour les installations existantes
      const globalSecret = this.configService.get<string>('SYNC_WEBHOOK_SECRET');
      if (!globalSecret || secret !== globalSecret) {
        throw new UnauthorizedException('Webhook secret invalide');
      }
      cineClubId = parseInt(cineClubIdHeader, 10);
      if (!cineClubId) throw new ForbiddenException('X-CineClubId header manquant (migrez vers un webhookSecret par CineClub)');
    }

    // Détection du boot NAS → mise à jour lastOnlineAt + notification WebSocket
    if (body?.trigger === 'nas_boot') {
      await this.prisma.cineClub.update({ where: { id: cineClubId }, data: { lastOnlineAt: new Date() } });
      this.syncGateway.emitNasOnline(cineClubId);
      // Profiter du boot pour enqueuer les métadonnées en attente
      this.syncService.enqueuePendingMetadata(cineClubId).catch((err) => console.error('Boot metadata sync failed:', err));
      return { message: 'Boot détecté, sync enclenchée' };
    }

    const hasDiff = (body?.added?.length ?? 0) + (body?.removed?.length ?? 0) + (body?.moved?.length ?? 0) > 0;
    if (hasDiff) {
      this.syncService.diffSync(cineClubId, body).catch((err) => console.error('Webhook diff sync failed:', err));
    } else {
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
