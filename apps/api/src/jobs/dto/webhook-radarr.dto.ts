export interface RadarrWebhookPayload {
  eventType?: string;
  movie?: {
    id?: number;
    title?: string;
    tmdbId?: number;
    imdbId?: string;
    year?: number;
    folderPath?: string;
  };
  movieFile?: {
    id?: number;
    relativePath?: string;
    path?: string;
    quality?: string;
    size?: number;
  };
  remoteMovie?: {
    tmdbId?: number;
    title?: string;
    year?: number;
  };
  release?: {
    quality?: string;
    size?: number;
    releaseTitle?: string;
  };
}

export interface SonarrEpisodeFile {
  id?: number;
  relativePath?: string;
  path?: string;
  quality?: string;
  size?: number;
}

export interface SonarrWebhookPayload {
  eventType?: string;
  series?: {
    id?: number;
    title?: string;
    tvdbId?: number;
    tmdbId?: number;
    imdbId?: string;
    path?: string;
  };
  episodes?: Array<{
    id?: number;
    episodeNumber?: number;
    seasonNumber?: number;
    title?: string;
    tvdbId?: number;
  }>;
  // Sonarr v3 → singulier, v4 → pluriel
  episodeFile?: SonarrEpisodeFile;
  episodeFiles?: SonarrEpisodeFile[];
  release?: {
    quality?: string;
    size?: number;
    releaseTitle?: string;
  };
}
