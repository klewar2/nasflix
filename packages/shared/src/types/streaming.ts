export type StreamMode = 'stream' | 'download';
export type StreamClient = 'web' | 'tv';
export type StreamSourceType = 'NAS' | 'SEEDBOX';

export interface StreamUrlResponse {
  url: string;
  isHls: boolean;
  durationSeconds: number;
  sourceType?: StreamSourceType;
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
