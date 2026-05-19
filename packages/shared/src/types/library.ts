export interface RadarrLibraryItem {
  radarrId: number;
  title: string;
  year: number | null;
  tmdbId: number | null;
  hasFile: boolean;
  sourcePath: string | null;
  fileName: string | null;
  fileSize: number | null;
  quality: string | null;
  onNas: boolean;
  nasDeletedAt: string | null;
  activeJobId: number | null;
}

export interface SonarrLibraryItem {
  sonarrSeriesId: number;
  sonarrEpisodeId: number;
  sonarrEpisodeFileId: number | null;
  seriesTitle: string;
  seriesTmdbId: number | null;
  seasonNumber: number;
  episodeNumber: number;
  episodeTitle: string | null;
  hasFile: boolean;
  sourcePath: string | null;
  fileName: string | null;
  fileSize: number | null;
  quality: string | null;
  onNas: boolean;
  activeJobId: number | null;
}
