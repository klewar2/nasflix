export type StreamSourceType = 'NAS' | 'SEEDBOX';

export interface StreamUrlResponse {
  url: string;
  isHls: boolean;
  durationSeconds: number;
  sourceType?: StreamSourceType;
  /** Champs Jellyfin : plus renvoyés par l'API (streaming SEEDBOX supprimé), conservés pour l'app TV déployée. */
  jellyfinItemId?: string;
  jellyfinBaseUrl?: string;
  jellyfinApiToken?: string;
}

export interface MediaAudioTrack {
  index: number;
  language: string;
  title: string;
  codec: string;
  channels: number;
}

export interface MediaSubtitleTrack {
  index: number;
  language: string;
  title: string;
  codec: string;
  jellyfinIndex?: number;
}

export interface MediaTracks {
  audio: MediaAudioTrack[];
  subtitles: MediaSubtitleTrack[];
}

export interface NasSubtitleTrack {
  trackIdx: number;
  language: string;
  title: string;
  codec: string;
  vttContent: string;
  /** Extraction encore en cours côté API : re-sonder le endpoint jusqu'à obtenir le VTT. */
  pending?: boolean;
  /** Progression de l'extraction (% du fichier lu depuis le NAS). */
  progressPercent?: number;
}

/** Piste sous-titre image (PGS) : état d'extraction ; le .sup se télécharge à part une fois `ready`. */
export interface NasImageSubtitleStatus {
  trackIdx: number;
  language: string;
  codec: string;
  ready: boolean;
  /** Extraction encore en cours côté API : re-sonder le endpoint. */
  pending?: boolean;
  /** Progression de l'extraction (% du fichier lu sur le NAS). */
  progressPercent?: number;
}
