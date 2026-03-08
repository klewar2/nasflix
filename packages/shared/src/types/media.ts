export enum MediaType {
  MOVIE = 'MOVIE',
  SERIES = 'SERIES',
}

export enum SyncStatus {
  PENDING = 'PENDING',
  SYNCING = 'SYNCING',
  SYNCED = 'SYNCED',
  FAILED = 'FAILED',
  NOT_FOUND = 'NOT_FOUND',
}

export interface MediaResponse {
  id: number;
  type: MediaType;
  titleVf: string | null;
  titleOriginal: string;
  nasPath: string;
  nasFilename: string;
  tmdbId: number | null;
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  trailerUrl: string | null;
  releaseYear: number | null;
  runtime: number | null;
  voteAverage: number | null;
  syncStatus: SyncStatus;
  genres: GenreResponse[];
  cast: PersonResponse[];
  createdAt: string;
}

export interface MediaDetailResponse extends MediaResponse {
  seasons?: SeasonResponse[];
}

export interface GenreResponse {
  id: number;
  tmdbId: number;
  name: string;
}

export interface PersonResponse {
  id: number;
  tmdbId: number;
  name: string;
  photoUrl: string | null;
  role: string;
  character: string | null;
  order: number;
}

export interface SeasonResponse {
  id: number;
  seasonNumber: number;
  name: string | null;
  overview: string | null;
  posterUrl: string | null;
  episodeCount: number | null;
  episodes: EpisodeResponse[];
}

export interface EpisodeResponse {
  id: number;
  episodeNumber: number;
  name: string | null;
  overview: string | null;
  runtime: number | null;
  stillUrl: string | null;
  nasPath: string | null;
}
