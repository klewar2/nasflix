import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JobKind, JobSource, JobStatus } from '@prisma/client';
import { JobsService } from './jobs.service';
import { JobsGateway } from './jobs.gateway';
import { PrismaService } from '../common/prisma.service';
import { Public } from '../auth/guards/public.decorator';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { ManualTransferDto } from './dto/manual-transfer.dto';
import { RadarrWebhookPayload, SonarrWebhookPayload } from './dto/webhook-radarr.dto';

@Controller('jobs')
export class JobsController {
  private readonly logger = new Logger(JobsController.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly gateway: JobsGateway,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post('webhook/radarr')
  async radarrWebhook(@Headers('x-webhook-secret') secret: string, @Body() body: RadarrWebhookPayload) {
    const club = await this.requireClubBySecret(secret);
    const parsed = this.jobsService.parseRadarrPayload(body, club.id);
    if (!parsed) return { ignored: true };
    const job = await this.jobsService.createDownloadJob({ ...parsed, triggeredBy: 'radarr-webhook' });
    this.gateway.emitJobCreated(club.id, job);
    return { jobId: job.id };
  }

  @Public()
  @Post('webhook/sonarr')
  async sonarrWebhook(@Headers('x-webhook-secret') secret: string, @Body() body: SonarrWebhookPayload) {
    const club = await this.requireClubBySecret(secret);
    const parsed = this.jobsService.parseSonarrPayload(body, club.id);
    if (!parsed) return { ignored: true };
    const job = await this.jobsService.createDownloadJob({ ...parsed, triggeredBy: 'sonarr-webhook' });
    this.gateway.emitJobCreated(club.id, job);
    return { jobId: job.id };
  }

  @Post('transfer/manual')
  @UseGuards(SuperAdminGuard)
  async manualTransfer(@Req() req: { user: JwtPayload }, @Body() dto: ManualTransferDto) {
    const cineClubId = this.requireCineClub(req.user);

    let sourcePath = dto.sourcePath ?? null;
    let fileName: string | null = null;
    let tmdbId = dto.tmdbId ?? null;
    let tmdbType = dto.tmdbType ?? null;
    let mediaId: number | null = dto.mediaId ?? null;

    if (dto.mediaId) {
      const media = await this.prisma.media.findFirst({ where: { id: dto.mediaId, cineClubId } });
      if (!media) throw new NotFoundException('Media introuvable');
      tmdbId = media.tmdbId ?? tmdbId;
      tmdbType = media.type === 'SERIES' ? 'tv' : 'movie';
      mediaId = media.id;
      fileName = media.nasFilename || media.titleOriginal;
    }

    if (!sourcePath) {
      throw new BadRequestException(
        'sourcePath requis (chemin absolu du fichier sur la seedbox)',
      );
    }
    if (!fileName) fileName = sourcePath.split('/').pop() ?? 'media.mkv';

    const job = await this.jobsService.createDownloadJob({
      cineClubId,
      source: JobSource.MANUAL,
      sourcePath,
      fileName,
      tmdbId,
      tmdbType: tmdbType ?? undefined,
      mediaId,
      triggeredBy: `user:${req.user.sub}`,
    });
    this.gateway.emitJobCreated(cineClubId, job);
    return { jobId: job.id };
  }

  @Post('delete-jellyfin/:mediaId')
  @UseGuards(SuperAdminGuard)
  async deleteFromJellyfin(@Req() req: { user: JwtPayload }, @Param('mediaId', ParseIntPipe) mediaId: number) {
    const cineClubId = this.requireCineClub(req.user);
    const media = await this.prisma.media.findFirst({ where: { id: mediaId, cineClubId } });
    if (!media) throw new NotFoundException('Media introuvable');
    if (!media.jellyfinItemId) throw new BadRequestException('Ce média n\'est pas sur Jellyfin');
    const job = await this.jobsService.createJellyfinDeletionJob({
      cineClubId,
      mediaId,
      jellyfinItemId: media.jellyfinItemId,
      triggeredBy: `user:${req.user.sub}`,
    });
    this.gateway.emitJobCreated(cineClubId, job);
    return { jobId: job.id };
  }

  @Get()
  @UseGuards(SuperAdminGuard)
  async list(
    @Req() req: { user: JwtPayload },
    @Query('kind') kind?: JobKind,
    @Query('status') status?: JobStatus,
    @Query('source') source?: JobSource,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number = 50,
  ) {
    const cineClubId = this.requireCineClub(req.user);
    return this.jobsService.list({ cineClubId, kind, status, source, page, limit });
  }

  @Get('active')
  @UseGuards(SuperAdminGuard)
  async listActive(@Req() req: { user: JwtPayload }) {
    const cineClubId = this.requireCineClub(req.user);
    return { items: await this.jobsService.listActive(cineClubId) };
  }

  @Get(':id')
  @UseGuards(SuperAdminGuard)
  async detail(@Req() req: { user: JwtPayload }, @Param('id', ParseIntPipe) id: number) {
    const cineClubId = this.requireCineClub(req.user);
    return this.jobsService.getById(id, cineClubId);
  }

  @Post(':id/cancel')
  @UseGuards(SuperAdminGuard)
  async cancel(@Req() req: { user: JwtPayload }, @Param('id', ParseIntPipe) id: number) {
    const cineClubId = this.requireCineClub(req.user);
    const job = await this.prisma.job.findFirst({ where: { id, cineClubId } });
    if (!job) throw new NotFoundException('Job introuvable');
    const cancelled = await this.jobsService.cancel(id);
    this.gateway.emitJobStatus(cineClubId, cancelled);
    return cancelled;
  }

  @Post(':id/retry')
  @UseGuards(SuperAdminGuard)
  async retry(@Req() req: { user: JwtPayload }, @Param('id', ParseIntPipe) id: number) {
    const cineClubId = this.requireCineClub(req.user);
    const job = await this.prisma.job.findFirst({ where: { id, cineClubId } });
    if (!job) throw new NotFoundException('Job introuvable');
    const retried = await this.jobsService.retry(id);
    this.gateway.emitJobStatus(cineClubId, retried);
    return retried;
  }

  @Delete(':id')
  @UseGuards(SuperAdminGuard)
  async remove(@Req() req: { user: JwtPayload }, @Param('id', ParseIntPipe) id: number) {
    const cineClubId = this.requireCineClub(req.user);
    const job = await this.prisma.job.findFirst({ where: { id, cineClubId } });
    if (!job) throw new NotFoundException('Job introuvable');
    const terminal: JobStatus[] = [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED];
    if (!terminal.includes(job.status)) {
      throw new BadRequestException('Seuls les jobs terminés peuvent être supprimés');
    }
    await this.prisma.job.delete({ where: { id } });
    return { deleted: true };
  }

  private requireCineClub(user: JwtPayload): number {
    if (!user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    return user.cineClubId;
  }

  private async requireClubBySecret(secret: string | undefined) {
    if (!secret) throw new UnauthorizedException('Header X-Webhook-Secret requis');
    const club = await this.prisma.cineClub.findUnique({ where: { webhookSecret: secret } });
    if (!club) throw new UnauthorizedException('Webhook secret invalide');
    return club;
  }
}
