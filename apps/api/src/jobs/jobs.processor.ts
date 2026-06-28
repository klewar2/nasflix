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
import { parseMediaFilename } from '../common/media-parser';

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

  // Extrait qualité vidéo / HDR / DV / Atmos depuis le nom du fichier, avec
  // fallback sur le dossier parent (les release groups laissent souvent ces
  // infos uniquement dans le nom du dossier).
  private parseQualityFromPath(nasPath: string): {
    videoQuality: string | null;
    hdr: boolean;
    dolbyVision: boolean;
    dolbyAtmos: boolean;
    audioFormat: string | null;
  } {
    const filename = nasPath.split('/').pop() ?? '';
    const parsed = parseMediaFilename(filename);
    const pathParts = nasPath.split('/').filter(Boolean);
    if (
      pathParts.length >= 2 &&
      (!parsed.videoQuality || (!parsed.hdr && !parsed.dolbyVision && !parsed.dolbyAtmos && !parsed.audioFormat))
    ) {
      const folderParsed = parseMediaFilename(pathParts[pathParts.length - 2] + '.mkv');
      if (!parsed.videoQuality) parsed.videoQuality = folderParsed.videoQuality;
      if (!parsed.hdr) parsed.hdr = folderParsed.hdr;
      if (!parsed.dolbyVision) parsed.dolbyVision = folderParsed.dolbyVision;
      if (!parsed.dolbyAtmos) parsed.dolbyAtmos = folderParsed.dolbyAtmos;
      if (!parsed.audioFormat) parsed.audioFormat = folderParsed.audioFormat;
    }
    return {
      videoQuality: parsed.videoQuality ?? null,
      hdr: parsed.hdr,
      dolbyVision: parsed.dolbyVision,
      dolbyAtmos: parsed.dolbyAtmos,
      audioFormat: parsed.audioFormat ?? null,
    };
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
    this.logger.log(`[processor] BullMQ déclenche job #${jobId}`);
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      this.logger.warn(`Job ${jobId} introuvable — skip`);
      return;
    }
    if (job.status === JobStatus.CANCELLED || job.status === JobStatus.COMPLETED) {
      this.logger.log(`Job ${jobId} déjà ${job.status} — skip`);
      return;
    }
    this.logger.log(`[processor] Job #${job.id} kind=${job.kind} status=${job.status} mediaId=${job.mediaId ?? 'null'} episodeId=${job.episodeId ?? 'null'} → dispatch`);
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
        case JobKind.DELETE_FROM_NAS:
          await this.runDeleteNas(job);
          break;
        case JobKind.DELETE_FROM_RADARR:
          await this.runDeleteRadarr(job);
          break;
        case JobKind.DELETE_FROM_SONARR:
          await this.runDeleteSonarr(job);
          break;
        default:
          this.logger.warn(`[processor] Job #${job.id} kind=${job.kind} non géré — pas de handler`);
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
    this.logger.log(`[runDeleteJellyfin] Job #${job.id} START itemId=${job.jellyfinItemId} episodeId=${job.episodeId ?? 'null'}`);
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

    if (job.episodeId) {
      await this.prisma.episode.update({
        where: { id: job.episodeId },
        data: { jellyfinItemId: null },
      }).catch(() => null);
    } else if (job.mediaId) {
      await this.prisma.media.update({
        where: { id: job.mediaId },
        data: { jellyfinItemId: null },
      }).catch(() => null);
    }
    await this.updateStatus(job, JobStatus.COMPLETED, { completedAt: new Date() });
  }

  // ── DELETE_FROM_NAS ───────────────────────────────────────────────────────

  private async runDeleteNas(job: JobRow): Promise<void> {
    this.logger.log(`[runDeleteNas] Job #${job.id} START path=${job.sourcePath}`);
    const club = await this.prisma.cineClub.findUnique({ where: { id: job.cineClubId } });
    if (!club) throw new Error('CineClub introuvable');
    if (!club.nasBaseUrl) throw new Error('NAS non configuré');
    if (!job.sourcePath) throw new Error('sourcePath manquant');

    // Récupère les credentials NAS depuis un membre du club (ADMIN en priorité)
    const member = await this.prisma.cineClubMember.findFirst({
      where: {
        cineClubId: job.cineClubId,
        nasUsername: { not: null },
        nasPassword: { not: null },
      },
      orderBy: { role: 'asc' }, // ADMIN avant VIEWER alphabétiquement
    });
    if (!member?.nasUsername || !member?.nasPassword) {
      throw new Error('Aucun membre avec credentials NAS configurés');
    }

    await this.updateStatus(job, JobStatus.IN_PROGRESS, { startedAt: new Date(), attempts: { increment: 1 } });

    const session = await this.nasService.getFileStationSession(club.nasBaseUrl, member.nasUsername, member.nasPassword);
    try {
      await this.nasService.deleteFile(session, job.sourcePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Synology FileStation error code 408 = "No such file or directory" — déjà supprimé, on tolère.
      if (/"code":\s*408/.test(msg) || /no such file/i.test(msg)) {
        this.logger.log(`Job ${job.id} NAS delete: fichier déjà absent (${job.sourcePath})`);
      } else {
        throw err;
      }
    }

    if (job.episodeId) {
      await this.prisma.episode.update({
        where: { id: job.episodeId },
        data: { nasDeletedAt: new Date() },
      }).catch(() => null);
    } else if (job.mediaId) {
      await this.prisma.media.update({
        where: { id: job.mediaId },
        data: { nasDeletedAt: new Date() },
      }).catch(() => null);
    }
    await this.updateStatus(job, JobStatus.COMPLETED, { completedAt: new Date() });
  }

  // ── DELETE_FROM_RADARR ────────────────────────────────────────────────────

  private async runDeleteRadarr(job: JobRow): Promise<void> {
    this.logger.log(`[runDeleteRadarr] Job #${job.id} START tmdbId=${job.tmdbId}`);
    const club = await this.prisma.cineClub.findUnique({ where: { id: job.cineClubId } });
    if (!club) throw new Error('CineClub introuvable');
    if (!club.radarrBaseUrl || !club.radarrApiKey) throw new Error('Radarr non configuré');
    if (!job.tmdbId) throw new Error('tmdbId manquant');

    await this.updateStatus(job, JobStatus.IN_PROGRESS, { startedAt: new Date(), attempts: { increment: 1 } });

    const apiKey = this.crypto.decrypt(club.radarrApiKey);
    const base = club.radarrBaseUrl.replace(/\/$/, '');
    const headers = { 'X-Api-Key': apiKey };

    const lookupRes = await fetch(`${base}/api/v3/movie?tmdbId=${job.tmdbId}`, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!lookupRes.ok) {
      const body = await lookupRes.text().catch(() => '');
      throw new Error(`Radarr lookup ${lookupRes.status}: ${body.slice(0, 500)}`);
    }
    const movies = (await lookupRes.json()) as Array<{ id: number }>;
    if (!Array.isArray(movies) || movies.length === 0) {
      this.logger.log(`Job ${job.id} Radarr: tmdbId=${job.tmdbId} introuvable — déjà supprimé`);
      await this.updateStatus(job, JobStatus.COMPLETED, { completedAt: new Date() });
      return;
    }

    const movieId = movies[0].id;
    const delUrl = `${base}/api/v3/movie/${movieId}?deleteFiles=true&addImportListExclusion=false`;
    const delRes = await fetch(delUrl, {
      method: 'DELETE',
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!delRes.ok && delRes.status !== 404) {
      const body = await delRes.text().catch(() => '');
      throw new Error(`Radarr DELETE ${delRes.status}: ${body.slice(0, 500)}`);
    }
    await this.updateStatus(job, JobStatus.COMPLETED, { completedAt: new Date() });
  }

  // ── DELETE_FROM_SONARR ────────────────────────────────────────────────────

  private async runDeleteSonarr(job: JobRow): Promise<void> {
    this.logger.log(`[runDeleteSonarr] Job #${job.id} START tmdbId=${job.tmdbId} episodeId=${job.episodeId ?? 'null'}`);
    const club = await this.prisma.cineClub.findUnique({ where: { id: job.cineClubId } });
    if (!club) throw new Error('CineClub introuvable');
    if (!club.sonarrBaseUrl || !club.sonarrApiKey) throw new Error('Sonarr non configuré');
    if (!job.tmdbId) throw new Error('tmdbId manquant');

    await this.updateStatus(job, JobStatus.IN_PROGRESS, { startedAt: new Date(), attempts: { increment: 1 } });

    const apiKey = this.crypto.decrypt(club.sonarrApiKey);
    const base = club.sonarrBaseUrl.replace(/\/$/, '');
    const headers = { 'X-Api-Key': apiKey };

    // Sonarr n'expose pas /series?tmdbId — on itère sur toutes les séries.
    const seriesRes = await fetch(`${base}/api/v3/series`, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!seriesRes.ok) {
      const body = await seriesRes.text().catch(() => '');
      throw new Error(`Sonarr series ${seriesRes.status}: ${body.slice(0, 500)}`);
    }
    const allSeries = (await seriesRes.json()) as Array<{ id: number; tmdbId?: number | null }>;
    const series = allSeries.find((s) => s.tmdbId === job.tmdbId);
    if (!series) {
      this.logger.log(`Job ${job.id} Sonarr: tmdbId=${job.tmdbId} introuvable — déjà supprimé`);
      await this.updateStatus(job, JobStatus.COMPLETED, { completedAt: new Date() });
      return;
    }

    // Cas épisode unique : on supprime juste l'episodefile correspondant.
    if (job.episodeId) {
      const filesRes = await fetch(`${base}/api/v3/episodefile?seriesId=${series.id}`, {
        headers,
        signal: AbortSignal.timeout(30_000),
      });
      if (!filesRes.ok) {
        const body = await filesRes.text().catch(() => '');
        throw new Error(`Sonarr episodefile ${filesRes.status}: ${body.slice(0, 500)}`);
      }
      const files = (await filesRes.json()) as Array<{ id: number; path: string; seasonNumber?: number }>;

      // Match prioritaire par sourcePath ; fallback par seasonNumber si non trouvé.
      let target: { id: number; path: string } | undefined;
      if (job.sourcePath) {
        target = files.find((f) => f.path === job.sourcePath);
      }
      if (!target && job.seasonNumber != null) {
        // Heuristique : Sonarr et Nasflix ont parfois des chemins différents (rsync vers
        // dossier NAS distinct). On matche sur le nom de fichier seul.
        const wantedFilename = job.sourcePath?.split('/').pop();
        if (wantedFilename) {
          target = files.find((f) => f.path.endsWith('/' + wantedFilename));
        }
      }
      if (!target) {
        this.logger.log(`Job ${job.id} Sonarr: episodefile introuvable pour ${job.sourcePath} — déjà supprimé`);
        await this.updateStatus(job, JobStatus.COMPLETED, { completedAt: new Date() });
        return;
      }

      const delRes = await fetch(`${base}/api/v3/episodefile/${target.id}`, {
        method: 'DELETE',
        headers,
        signal: AbortSignal.timeout(30_000),
      });
      if (!delRes.ok && delRes.status !== 404) {
        const body = await delRes.text().catch(() => '');
        throw new Error(`Sonarr DELETE episodefile ${delRes.status}: ${body.slice(0, 500)}`);
      }
      await this.updateStatus(job, JobStatus.COMPLETED, { completedAt: new Date() });
      return;
    }

    // Cas série entière.
    const delUrl = `${base}/api/v3/series/${series.id}?deleteFiles=true&addImportListExclusion=false`;
    const delRes = await fetch(delUrl, {
      method: 'DELETE',
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!delRes.ok && delRes.status !== 404) {
      const body = await delRes.text().catch(() => '');
      throw new Error(`Sonarr DELETE series ${delRes.status}: ${body.slice(0, 500)}`);
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

    const quality = this.parseQualityFromPath(nasPath);

    if (existing) {
      // Met à jour la qualité uniquement si elle n'a pas déjà été détectée
      // (sinon on risque d'écraser un champ correct par un null venant d'un
      // filename moins descriptif après un move/re-rsync).
      const qualityPatch: Record<string, unknown> = {};
      if (!existing.videoQuality && quality.videoQuality) qualityPatch.videoQuality = quality.videoQuality;
      if (!existing.hdr && quality.hdr) qualityPatch.hdr = true;
      if (!existing.dolbyVision && quality.dolbyVision) qualityPatch.dolbyVision = true;
      if (!existing.dolbyAtmos && quality.dolbyAtmos) qualityPatch.dolbyAtmos = true;
      if (!existing.audioFormat && quality.audioFormat) qualityPatch.audioFormat = quality.audioFormat;

      const updated = await this.prisma.media.update({
        where: { id: existing.id },
        data: {
          nasPath,
          nasFilename: nasPath.split('/').pop() ?? '',
          nasSize: job.fileSize ?? null,
          nasAddedAt: new Date(),
          sourceType: SourceType.NAS,
          nasDeletedAt: null,
          ...qualityPatch,
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
        videoQuality: quality.videoQuality,
        hdr: quality.hdr,
        dolbyVision: quality.dolbyVision,
        dolbyAtmos: quality.dolbyAtmos,
        audioFormat: quality.audioFormat,
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

    const quality = this.parseQualityFromPath(nasPath);

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
          videoQuality: quality.videoQuality,
          hdr: quality.hdr,
          dolbyVision: quality.dolbyVision,
          dolbyAtmos: quality.dolbyAtmos,
          audioFormat: quality.audioFormat,
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
