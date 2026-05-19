export const MEDIA_TYPES = ['MOVIE', 'SERIES'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const SYNC_STATUSES = ['PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'NOT_FOUND'] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export interface GenreResponse {
  id: number;
  tmdbId: number;
  name: string;
}

/** Forme renvoyée par l'API : relation m2m Media ↔ Genre (`include: { genre: true }`). */
export interface MediaGenreRelation {
  genreId: number;
  mediaId: number;
  genre: GenreResponse;
}

export interface PersonResponse {
  id: number;
  tmdbId: number;
  name: string;
  photoUrl: string | null;
}

/** Forme renvoyée : MediaCast avec relation `person`. */
export interface MediaCastEntry {
  id: number;
  mediaId: number;
  personId: number;
  role: string;
  character: string | null;
  order: number;
  person: PersonResponse;
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
  videoQuality: string | null;
  hdr: boolean;
  dolbyVision: boolean;
  dolbyAtmos: boolean;
  audioFormat: string | null;
  syncStatus: SyncStatus;
  syncError: string | null;
  sourceType?: 'NAS' | 'SEEDBOX';
  jellyfinItemId?: string | null;
  nasDeletedAt?: string | null;
  nasAddedAt?: string | null;
  genres: MediaGenreRelation[];
  cast: MediaCastEntry[];
  createdAt: string;
}

export interface MediaDetailResponse extends MediaResponse {
  seasons?: SeasonResponse[];
}

export interface SeasonResponse {
  id: number;
  seasonNumber: number;
  name: string | null;
  overview: string | null;
  posterUrl: string | null;
  airDate: string | null;
  episodeCount: number | null;
  episodes: EpisodeResponse[];
}

export interface EpisodeResponse {
  id: number;
  episodeNumber: number;
  seasonNumber?: number;
  name: string | null;
  overview: string | null;
  runtime: number | null;
  airDate: string | null;
  stillUrl: string | null;
  nasPath: string | null;
  nasFilename: string | null;
  sourceType?: 'NAS' | 'SEEDBOX';
  jellyfinItemId?: string | null;
  nasDeletedAt?: string | null;
}
