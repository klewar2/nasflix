export const JOB_KINDS = ['DOWNLOAD_TO_NAS', 'DELETE_FROM_SEEDBOX', 'DELETE_FROM_JELLYFIN'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_SOURCES = ['RADARR', 'SONARR', 'MANUAL', 'NAS_SYNC'] as const;
export type JobSource = (typeof JOB_SOURCES)[number];

export const JOB_STATUSES = [
  'PENDING',
  'AWAITING_NAS',
  'AWAITING_SEEDBOX',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export interface JobResponse {
  id: number;
  cineClubId: number;
  kind: JobKind;
  source: JobSource;
  status: JobStatus;
  tmdbId: number | null;
  tmdbType: string | null;
  mediaId: number | null;
  episodeId: number | null;
  seriesTitle: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  sourcePath: string | null;
  fileName: string | null;
  fileSize: number | null;
  targetPath: string | null;
  jellyfinItemId: string | null;
  scheduledFor: string | null;
  attempts: number;
  errorMessage: string | null;
  errorDetails: unknown;
  progressPercent: number | null;
  triggeredBy: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

export interface JobSocketEvent {
  cineClubId: number;
  job: JobResponse;
}

export interface JobProgressSocketEvent {
  cineClubId: number;
  jobId: number;
  percent: number;
}
