import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job as BullJob, Queue } from 'bullmq';
import { Client as SshClient } from 'ssh2';
import { Job as JobRow, JobKind, JobStatus, MediaType, SourceType, SyncStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { NasService } from '../nas/nas.service';
import { MediaService } from '../media/media.service';
import { MailService } from '../mail/mail.service';
import { MetadataService } from '../metadata/metadata.service';
import { JobsGateway } from './jobs.gateway';
import { JOBS_QUEUE } from './jobs.constants';
import { METADATA_SYNC_QUEUE } from '../sync/sync.constants';

interface JobRunData {
  jobId: number;
}

@Processor(JOBS_QUEUE, { concurrency: 2 })
export class JobsProcessor extends WorkerHost {
  private readonly logger = new Logger(JobsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly nasService: NasService,
    private readonly mediaService: MediaService,
    private readonly mailService: MailService,
    private readonly metadataService: MetadataService,
    private readonly gateway: JobsGateway,
    @InjectQueue(METADATA_SYNC_QUEUE) private readonly metadataQueue: Queue,
  ) {
    super();
  }

  private async enqueueMetadataSync(mediaId: number, cineClubId: number) {
    await this.metadataQueue.add(
      'sync-metadata',
      { mediaId, cineClubId },
      {
        jobId: `media-${mediaId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    ).catch((e) => this.logger.warn(`Enqueue metadata sync échoué pour Media ${mediaId}: ${e}`));
  }

  async process(bullJob: BullJob<JobRunData>): Promise<void> {
    const { jobId } = bullJob.data;
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      this.logger.warn(`Job ${jobId} introuvable — skip`);
      return;
    }
    if (job.status === JobStatus.CANCELLED || job.status === JobStatus.COMPLETED) {
      this.logger.log(`Job ${jobId} déjà ${job.status} — skip`);
      return;
    }
    try {
      switch (job.kind) {
        case JobKind.DOWNLOAD_TO_NAS:
          await this.runDownload(job);
          break;
        case JobKind.DELETE_FROM_SEEDBOX:
          await this.runDeleteSeedbox(job);
          break;
        case JobKind.DELETE_FROM_JELLYFIN:
          await this.runDeleteJellyfin(job);
          break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Job ${jobId} en échec: ${message}`);
      const stack = err instanceof Error ? err.stack : undefined;
      const updated = await this.markFailed(job, message, stack);
      await this.mailService.sendJobFailedAlert(updated).catch((e) => this.logger.error(`Mail alert: ${e}`));
    }
  }

  // ── DOWNLOAD_TO_NAS ──────────────────────────────────────────────────────

  private async runDownload(job: JobRow): Promise<void> {
    // Garde-fou contre les doublons créés AVANT la dédup côté service (jobs
    // historiques) : si un autre job DOWNLOAD_TO_NAS plus ancien et non-terminal
    // pointe sur le même sourcePath, on annule celui-ci.
    if (job.sourcePath) {
      const concurrent = await this.prisma.job.findFirst({
        where: {
          id: { not: job.id, lt: job.id },
          cineClubId: job.cineClubId,
          kind: JobKind.DOWNLOAD_TO_NAS,
          sourcePath: job.sourcePath,
          status: { in: [JobStatus.PENDING, JobStatus.AWAITING_NAS, JobStatus.AWAITING_SEEDBOX, JobStatus.IN_PROGRESS, JobStatus.COMPLETED] },
        },
      });
      if (concurrent) {
        this.logger.log(`Job ${job.id} dédoublonné (concurrent=${concurrent.id} status=${concurrent.status}) — annulé`);
        await this.updateStatus(job, JobStatus.CANCELLED, { cancelledAt: new Date() });
        return;
      }
    }
    const club = await this.prisma.cineClub.findUnique({ where: { id: job.cineClubId } });
    if (!club) throw new Error('CineClub introuvable');
    if (!club.nasBaseUrl) throw new Error('NAS non configuré');
    if (!club.seedboxSshHost || !club.seedboxSshUser || !club.seedboxSshPrivateKey) {
      throw new Error('SSH seedbox non configuré (host/user/privateKey requis)');
    }
    if (!club.nasSshHost || !club.nasSshUser) {
      throw new Error('SSH NAS non configuré (host/user requis)');
    }
    const targetDir = job.tmdbType === 'tv' ? club.nasTargetSeriesDir : club.nasTargetMovieDir;
    if (!targetDir) throw new Error(`Dossier cible NAS non configuré (${job.tmdbType === 'tv' ? 'séries' : 'films'})`);
    if (!job.sourcePath || !job.fileName) throw new Error('sourcePath/fileName manquant');

    // 1. WoL + ping wait
    await this.updateStatus(job, JobStatus.AWAITING_NAS, { startedAt: new Date(), attempts: { increment: 1 } });
    const online = await this.waitForNas(club.id, club.nasBaseUrl, club.nasWolWaitSeconds);
    if (!online) {
      const failed = await this.markFailed(
        { ...job, status: JobStatus.AWAITING_NAS },
        `NAS non joignable après ${club.nasWolWaitSeconds}s (WoL échec)`,
      );
      await this.mailService.sendWolFailedAlert(club, failed);
      throw new Error('WoL timeout — alerte envoyée');
    }

    // 2. SSH seedbox + rsync
    await this.updateStatus(job, JobStatus.IN_PROGRESS);
    const subDir = this.computeSubDir(job);
    const baseDir = targetDir.replace(/\/$/, '');
    const finalDir = subDir ? `${baseDir}/${subDir}` : baseDir;
    const targetPath = `${finalDir}/${job.fileName}`;
    await this.prisma.job.update({ where: { id: job.id }, data: { targetPath } });

    const rsyncCmd = this.buildRsyncCommand({
      sourcePath: job.sourcePath,
      nasUser: club.nasSshUser,
      nasHost: club.nasSshHost,
      nasPort: club.nasSshPort,
      targetDir: finalDir,
      keyPath: club.seedboxToNasKeyPath ?? null,
      ensureRemoteDir: !!subDir,
    });
    this.logger.log(`Job ${job.id} — rsync seedbox→NAS : ${rsyncCmd}`);

    const result = await this.execSsh({
      host: club.seedboxSshHost,
      port: club.seedboxSshPort,
      user: club.seedboxSshUser,
      privateKey: this.crypto.decrypt(club.seedboxSshPrivateKey),
      passphrase: club.seedboxSshPassphrase ? this.crypto.decrypt(club.seedboxSshPassphrase) : undefined,
      command: rsyncCmd,
      onProgress: async (percent) => {
        await this.prisma.job.update({ where: { id: job.id }, data: { progressPercent: percent } }).catch(() => null);
        this.gateway.emitJobProgress(job.cineClubId, job.id, percent);
      },
    });

    if (result.code !== 0) {
      // Log compact (tail) côté Railway pour le diag — la stderr complète va dans l'erreur Job en DB
      this.logger.error(`Job ${job.id} rsync EXIT=${result.code} — tail stderr:\n${result.stderr.slice(-1500)}`);
      throw new Error(`rsync exit code ${result.code}\nstderr (last 8000):\n${result.stderr.slice(-8000)}`);
    }

    // 3. Catalog upsert + jellyfinId
    await this.registerInCatalog(job, targetPath);

    await this.updateStatus(job, JobStatus.COMPLETED, { completedAt: new Date(), progressPercent: 100 });
  }

  // ── DELETE_FROM_SEEDBOX ───────────────────────────────────────────────────

  private async runDeleteSeedbox(job: JobRow): Promise<void> {
    if (job.scheduledFor && job.scheduledFor.getTime() > Date.now()) {
      this.logger.log(`Job ${job.id} pas encore prêt (scheduledFor=${job.scheduledFor.toISOString()})`);
      return;
    }
    const club = await this.prisma.cineClub.findUnique({ where: { id: job.cineClubId } });
    if (!club) throw new Error('CineClub introuvable');
    if (!club.seedboxSshHost || !club.seedboxSshUser || !club.seedboxSshPrivateKey) {
      throw new Error('SSH seedbox non configuré');
    }
    if (!job.sourcePath) throw new Error('sourcePath manquant');
    if (!job.sourcePath.startsWith('/')) throw new Error('sourcePath doit être absolu');

    await this.updateStatus(job, JobStatus.IN_PROGRESS, { startedAt: new Date(), attempts: { increment: 1 } });

    const result = await this.execSsh({
      host: club.seedboxSshHost,
      port: club.seedboxSshPort,
      user: club.seedboxSshUser,
      privateKey: this.crypto.decrypt(club.seedboxSshPrivateKey),
      passphrase: club.seedboxSshPassphrase ? this.crypto.decrypt(club.seedboxSshPassphrase) : undefined,
      command: `rm -f -- ${shellEscape(job.sourcePath)}`,
    });

    if (result.code !== 0) {
      throw new Error(`rm exit code ${result.code}\nstderr:\n${result.stderr.slice(-8000)}`);
    }
    await this.updateStatus(job, JobStatus.COMPLETED, { completedAt: new Date() });
  }

  // ── DELETE_FROM_JELLYFIN ──────────────────────────────────────────────────

  private async runDeleteJellyfin(job: JobRow): Promise<void> {
    const club = await this.prisma.cineClub.findUnique({ where: { id: job.cineClubId } });
    if (!club) throw new Error('CineClub introuvable');
    if (!club.jellyfinBaseUrl || !club.jellyfinApiToken) throw new Error('Jellyfin non configuré');
    if (!job.jellyfinItemId) throw new Error('jellyfinItemId manquant');

    await this.updateStatus(job, JobStatus.IN_PROGRESS, { startedAt: new Date(), attempts: { increment: 1 } });

    const base = club.jellyfinBaseUrl.replace(/\/$/, '');
    const url = `${base}/Items/${encodeURIComponent(job.jellyfinItemId)}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { 'X-Emby-Token': club.jellyfinApiToken },
    });
    if (!res.ok && res.status !== 404) {
      const body = await res.text().catch(() => '');
      throw new Error(`Jellyfin DELETE ${res.status} ${res.statusText}\n${body.slice(0, 1000)}`);
    }

    if (job.mediaId) {
      await this.prisma.media.update({
        where: { id: job.mediaId },
        data: { jellyfinItemId: null },
      }).catch(() => null);
    }
    await this.updateStatus(job, JobStatus.COMPLETED, { completedAt: new Date() });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async waitForNas(cineClubId: number, baseUrl: string, totalSeconds: number): Promise<boolean> {
    const start = Date.now();
    const deadline = start + totalSeconds * 1000;
    let triedWol = false;
    while (Date.now() < deadline) {
      const online = await this.nasService.checkStatus(baseUrl);
      if (online) {
        await this.prisma.cineClub.update({ where: { id: cineClubId }, data: { lastOnlineAt: new Date() } }).catch(() => null);
        return true;
      }
      if (!triedWol) {
        triedWol = true;
        try {
          await this.nasService.sendWakeOnLan(cineClubId);
          this.logger.log(`WoL envoyé pour CineClub ${cineClubId}`);
        } catch (err) {
          this.logger.warn(`WoL échoué pour CineClub ${cineClubId}: ${err}`);
        }
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }
    return false;
  }

  private computeSubDir(job: JobRow): string | null {
    if (job.tmdbType !== 'tv') return null;
    if (!job.seriesTitle || job.seasonNumber == null) return null;
    return `${sanitizeFolderName(job.seriesTitle)}/Season ${job.seasonNumber}`;
  }

  private buildRsyncCommand(p: {
    sourcePath: string;
    nasUser: string;
    nasHost: string;
    nasPort: number;
    targetDir: string;
    keyPath: string | null;
    ensureRemoteDir?: boolean;
  }): string {
    const verbose = process.env.SSH_VERBOSE === '1';
    const sshOpts: string[] = [];
    if (verbose) sshOpts.push('-vvv');
    sshOpts.push('-o StrictHostKeyChecking=accept-new', `-p ${p.nasPort}`);
    if (p.keyPath) {
      // -i et IdentitiesOnly évitent de dépendre de ~/.ssh/config (non lu dans certains contextes non-interactifs)
      sshOpts.push(`-o IdentityFile=${shellEscape(p.keyPath)}`, '-o IdentitiesOnly=yes');
    }
    const sshCmd = `ssh ${sshOpts.join(' ')}`;
    const dir = p.targetDir.replace(/\/$/, '');
    const target = `${p.nasUser}@${p.nasHost}:${dir}/`;
    const parts = ['rsync', '-av', '--partial', '--info=progress2'];
    if (p.ensureRemoteDir) {
      // mkdir -p côté NAS avant rsync : --rsync-path est exécuté à la place du
      // rsync distant et permet d'enchaîner un mkdir puis le vrai rsync.
      parts.push(`--rsync-path=${shellEscape(`mkdir -p ${shellEscape(dir)} && rsync`)}`);
    }
    parts.push(`-e ${shellEscape(sshCmd)}`, shellEscape(p.sourcePath), shellEscape(target));
    return parts.join(' ');
  }

  private async execSsh(p: {
    host: string;
    port: number;
    user: string;
    privateKey: string;
    passphrase?: string;
    command: string;
    onProgress?: (percent: number) => Promise<void>;
  }): Promise<{ code: number; stdout: string; stderr: string }> {
    return await new Promise((resolve, reject) => {
      const client = new SshClient();
      let stdout = '';
      let stderr = '';
      let lastProgress = -1;

      const handleStream = (data: string) => {
        if (!p.onProgress) return;
        const match = data.match(/(\d{1,3})%/g);
        if (match && match.length > 0) {
          const lastMatch = match[match.length - 1];
          const percent = parseInt(lastMatch, 10);
          if (!Number.isNaN(percent) && percent !== lastProgress && percent <= 100) {
            lastProgress = percent;
            p.onProgress(percent).catch(() => null);
          }
        }
      };

      client
        .on('ready', () => {
          client.exec(p.command, (err, stream) => {
            if (err) {
              client.end();
              return reject(err);
            }
            stream
              .on('close', (code: number | null) => {
                client.end();
                resolve({ code: code ?? -1, stdout, stderr });
              })
              .on('data', (data: Buffer) => {
                const chunk = data.toString('utf8');
                stdout += chunk;
                handleStream(chunk);
              })
              .stderr.on('data', (data: Buffer) => {
                const chunk = data.toString('utf8');
                stderr += chunk;
                handleStream(chunk);
              });
          });
        })
        .on('error', (err) => reject(err))
        .connect({
          host: p.host,
          port: p.port,
          username: p.user,
          privateKey: p.privateKey,
          passphrase: p.passphrase,
          readyTimeout: 30_000,
        });
    });
  }

  private async registerInCatalog(job: JobRow, nasPath: string): Promise<void> {
    if (job.tmdbType === 'tv') {
      await this.registerTvInCatalog(job, nasPath);
      return;
    }

    if (!job.tmdbId) {
      this.logger.warn(`Job ${job.id} sans tmdbId — diffSync NAS prendra le relais`);
      return;
    }

    const existing = await this.prisma.media.findFirst({
      where: { cineClubId: job.cineClubId, tmdbId: job.tmdbId, type: MediaType.MOVIE },
    });

    if (existing) {
      const updated = await this.prisma.media.update({
        where: { id: existing.id },
        data: {
          nasPath,
          nasFilename: nasPath.split('/').pop() ?? '',
          nasSize: job.fileSize ?? null,
          nasAddedAt: new Date(),
          sourceType: SourceType.NAS,
          nasDeletedAt: null,
        },
      });
      await this.mediaService.populateJellyfinId(updated, 'movie').catch((e) =>
        this.logger.warn(`populateJellyfinId échoué pour Media ${updated.id}: ${e}`),
      );
      return;
    }

    const created = await this.prisma.media.create({
      data: {
        cineClubId: job.cineClubId,
        type: MediaType.MOVIE,
        titleOriginal: job.fileName ?? 'Untitled',
        nasPath,
        nasFilename: nasPath.split('/').pop() ?? '',
        nasSize: job.fileSize ?? null,
        nasAddedAt: new Date(),
        sourceType: SourceType.NAS,
        tmdbId: job.tmdbId,
      },
    });
    await this.enqueueMetadataSync(created.id, created.cineClubId);
    await this.mediaService.populateJellyfinId(created, 'movie').catch((e) =>
      this.logger.warn(`populateJellyfinId échoué pour Media ${created.id}: ${e}`),
    );
  }

  private async registerTvInCatalog(job: JobRow, nasPath: string): Promise<void> {
    if (!job.tmdbId || job.seasonNumber == null || job.episodeNumber == null) {
      this.logger.warn(`Job ${job.id} TV : tmdbId/season/episode manquant — diffSync NAS prendra le relais`);
      return;
    }

    let media = await this.prisma.media.findFirst({
      where: { cineClubId: job.cineClubId, tmdbId: job.tmdbId, type: MediaType.SERIES },
    });

    if (!media) {
      // Squelette série : diffSync NAS enrichira via TMDB (syncStatus=PENDING).
      // nasPath sur Media est requis par le schéma : on utilise le chemin de
      // l'épisode comme ancre (convention déjà appliquée par diffSync existant).
      media = await this.prisma.media.create({
        data: {
          cineClubId: job.cineClubId,
          type: MediaType.SERIES,
          titleOriginal: job.seriesTitle ?? `tmdb:${job.tmdbId}`,
          tmdbId: job.tmdbId,
          nasPath,
          nasFilename: nasPath.split('/').pop() ?? '',
          nasSize: job.fileSize ?? null,
          nasAddedAt: new Date(),
          sourceType: SourceType.NAS,
          syncStatus: SyncStatus.PENDING,
        },
      });
      this.logger.log(`Media SERIES créé (id=${media.id}, tmdbId=${job.tmdbId}) — sync TMDB enclenchée`);
      await this.enqueueMetadataSync(media.id, media.cineClubId);
    }

    const season = await this.prisma.season.upsert({
      where: { mediaId_seasonNumber: { mediaId: media.id, seasonNumber: job.seasonNumber } },
      update: {},
      create: { mediaId: media.id, seasonNumber: job.seasonNumber },
    });

    // Méta TMDB de l'épisode (titre/overview/runtime/still) — best-effort, non bloquant.
    let epMeta: { name?: string; overview?: string; runtime?: number | null; airDate?: Date | null; stillUrl?: string | null } = {};
    try {
      const detail = await this.metadataService.getTvEpisodeDetail(job.tmdbId, job.seasonNumber, job.episodeNumber, job.cineClubId);
      if (detail) {
        epMeta = {
          name: detail.name || undefined,
          overview: detail.overview || undefined,
          runtime: detail.runtime ?? null,
          airDate: detail.air_date ? new Date(detail.air_date) : null,
          stillUrl: this.metadataService.stillUrl(detail.still_path),
        };
      }
    } catch (e) {
      this.logger.warn(`getTvEpisodeDetail échoué (tmdb=${job.tmdbId} S${job.seasonNumber}E${job.episodeNumber}): ${e}`);
    }

    await this.prisma.episode.upsert({
      where: { seasonId_episodeNumber: { seasonId: season.id, episodeNumber: job.episodeNumber } },
      update: {
        nasPath,
        nasFilename: nasPath.split('/').pop() ?? null,
        nasSize: job.fileSize ?? null,
        sourceType: SourceType.NAS,
        nasDeletedAt: null,
        ...epMeta,
      },
      create: {
        seasonId: season.id,
        episodeNumber: job.episodeNumber,
        nasPath,
        nasFilename: nasPath.split('/').pop() ?? null,
        nasSize: job.fileSize ?? null,
        sourceType: SourceType.NAS,
        ...epMeta,
      },
    });

    await this.prisma.media.update({
      where: { id: media.id },
      data: { nasAddedAt: new Date() },
    });

    await this.mediaService.populateJellyfinId(media, 'tv').catch((e) =>
      this.logger.warn(`populateJellyfinId échoué pour Media ${media!.id}: ${e}`),
    );
  }

  private async updateStatus(
    job: JobRow,
    status: JobStatus,
    extra: Parameters<PrismaService['job']['update']>[0]['data'] = {},
  ): Promise<void> {
    const updated = await this.prisma.job.update({
      where: { id: job.id },
      data: { status, ...extra },
    });
    this.gateway.emitJobStatus(job.cineClubId, updated);
  }

  private async markFailed(job: JobRow, message: string, stack?: string): Promise<JobRow> {
    const updated = await this.prisma.job.update({
      where: { id: job.id },
      data: {
        status: JobStatus.FAILED,
        errorMessage: message.slice(0, 2000),
        errorDetails: stack ? { stack: stack.slice(0, 5000) } : undefined,
        completedAt: new Date(),
      },
    });
    this.gateway.emitJobStatus(job.cineClubId, updated);
    return updated;
  }

  @OnWorkerEvent('failed')
  onFailed(bullJob: BullJob<JobRunData> | undefined, error: Error) {
    this.logger.error(`Bull job échec (jobId=${bullJob?.data?.jobId}): ${error.message}`);
  }
}

function shellEscape(s: string): string {
  if (s === '') return "''";
  if (/^[a-zA-Z0-9_\-./@:=,]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// Nom de dossier safe pour ext4/btrfs : on remplace les caractères posant
// problème (/, \, :, *, ?, ", <, >, |) par "-" et on trim les espaces.
function sanitizeFolderName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'unknown';
}
