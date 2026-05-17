import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job as BullJob } from 'bullmq';
import { Client as SshClient } from 'ssh2';
import { Job as JobRow, JobKind, JobStatus, MediaType, SourceType } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { NasService } from '../nas/nas.service';
import { MediaService } from '../media/media.service';
import { MailService } from '../mail/mail.service';
import { JobsGateway } from './jobs.gateway';
import { JOBS_QUEUE } from './jobs.constants';

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
    private readonly gateway: JobsGateway,
  ) {
    super();
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
    const targetPath = `${targetDir.replace(/\/$/, '')}/${job.fileName}`;
    await this.prisma.job.update({ where: { id: job.id }, data: { targetPath } });

    const rsyncCmd = this.buildRsyncCommand({
      sourcePath: job.sourcePath,
      nasUser: club.nasSshUser,
      nasHost: club.nasSshHost,
      nasPort: club.nasSshPort,
      targetDir,
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
      throw new Error(`rsync exit code ${result.code}\nstderr:\n${result.stderr.slice(-2000)}`);
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
      throw new Error(`rm exit code ${result.code}\nstderr:\n${result.stderr.slice(-2000)}`);
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

  private buildRsyncCommand(p: {
    sourcePath: string;
    nasUser: string;
    nasHost: string;
    nasPort: number;
    targetDir: string;
  }): string {
    const sshArgs = `-o StrictHostKeyChecking=accept-new -p ${p.nasPort}`;
    const target = `${p.nasUser}@${p.nasHost}:${p.targetDir.replace(/\/$/, '')}/`;
    return [
      'rsync',
      '-av',
      '--partial',
      '--info=progress2',
      `-e ${shellEscape(`ssh ${sshArgs}`)}`,
      shellEscape(p.sourcePath),
      shellEscape(target),
    ].join(' ');
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
      // Pour les séries on s'appuie sur le diff sync NAS pour structure Season/Episode.
      // Ici on touche juste la propriété nasPath de l'épisode si on a un mediaId+seasonNumber+episodeNumber.
      // Sinon on laisse le prochain diffSync prendre le relais.
      if (job.episodeId) {
        await this.prisma.episode.update({
          where: { id: job.episodeId },
          data: { nasPath, nasFilename: nasPath.split('/').pop() ?? null, sourceType: SourceType.NAS, nasDeletedAt: null },
        }).catch(() => null);
      }
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
    await this.mediaService.populateJellyfinId(created, 'movie').catch((e) =>
      this.logger.warn(`populateJellyfinId échoué pour Media ${created.id}: ${e}`),
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
