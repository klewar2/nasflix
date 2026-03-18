import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ConfigService } from '@nestjs/config';

export interface TmdbSearchResult {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  vote_count?: number;
  genre_ids?: number[];
  media_type?: string;
}

interface TmdbMovieDetail {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  runtime: number;
  vote_average: number;
  genres: { id: number; name: string }[];
  videos?: { results: { key: string; site: string; type: string }[] };
  credits?: {
    cast: { id: number; name: string; character: string; profile_path: string | null; order: number }[];
    crew: { id: number; name: string; job: string; profile_path: string | null }[];
  };
}

interface TmdbEpisodeDetail {
  id: number;
  episode_number: number;
  season_number: number;
  name: string;
  overview: string;
  runtime: number | null;
  air_date: string | null;
  still_path: string | null;
  vote_average: number;
}

interface TmdbTvDetail {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string;
  episode_run_time: number[];
  vote_average: number;
  genres: { id: number; name: string }[];
  seasons: {
    season_number: number;
    name: string;
    overview: string;
    poster_path: string | null;
    episode_count: number;
    air_date: string;
  }[];
  videos?: { results: { key: string; site: string; type: string }[] };
  credits?: {
    cast: { id: number; name: string; character: string; profile_path: string | null; order: number }[];
    crew: { id: number; name: string; job: string; profile_path: string | null }[];
  };
}

@Injectable()
export class MetadataService {
  private readonly logger = new Logger(MetadataService.name);
  private readonly imageBaseUrl = 'https://image.tmdb.org/t/p';

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getApiKeyForCineClub(cineClubId?: number): Promise<string> {
    if (cineClubId) {
      const club = await this.prisma.cineClub.findUnique({ where: { id: cineClubId } });
      if (club?.tmdbApiKey) return club.tmdbApiKey;
    }

    const envKey = this.configService.get<string>('TMDB_API_KEY');
    if (envKey) return envKey;

    throw new Error('No TMDB API key configured');
  }

  private async tmdbFetch<T>(path: string, params: Record<string, string> = {}, apiKey?: string): Promise<T> {
    const key = apiKey ?? (await this.getApiKeyForCineClub());
    const url = new URL(`https://api.themoviedb.org/3${path}`);
    url.searchParams.set('api_key', key);
    url.searchParams.set('language', 'fr-FR');
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`TMDB API error: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  async searchMulti(query: string, year?: number, cineClubId?: number): Promise<TmdbSearchResult[]> {
    const apiKey = await this.getApiKeyForCineClub(cineClubId);
    const params: Record<string, string> = { query };
    if (year) params.year = String(year);

    const result = await this.tmdbFetch<{ results: TmdbSearchResult[] }>(
      '/search/multi',
      params,
      apiKey,
    );

    return result.results.filter(
      (r) => r.media_type === 'movie' || r.media_type === 'tv',
    );
  }

  async searchMovie(query: string, year?: number, cineClubId?: number): Promise<TmdbSearchResult[]> {
    const apiKey = await this.getApiKeyForCineClub(cineClubId);
    const params: Record<string, string> = { query };
    if (year) params.year = String(year);

    const result = await this.tmdbFetch<{ results: TmdbSearchResult[] }>('/search/movie', params, apiKey);
    return result.results;
  }

  async searchTv(query: string, year?: number, cineClubId?: number): Promise<TmdbSearchResult[]> {
    const apiKey = await this.getApiKeyForCineClub(cineClubId);
    const params: Record<string, string> = { query };
    if (year) params.first_air_date_year = String(year);

    const result = await this.tmdbFetch<{ results: TmdbSearchResult[] }>('/search/tv', params, apiKey);
    return result.results;
  }

  async getTvEpisodeDetail(seriesId: number, season: number, episode: number, cineClubId?: number): Promise<TmdbEpisodeDetail | null> {
    try {
      const apiKey = await this.getApiKeyForCineClub(cineClubId);
      return await this.tmdbFetch<TmdbEpisodeDetail>(`/tv/${seriesId}/season/${season}/episode/${episode}`, {}, apiKey);
    } catch {
      return null;
    }
  }

  async getMovieDetail(tmdbId: number, cineClubId?: number): Promise<TmdbMovieDetail> {
    const apiKey = await this.getApiKeyForCineClub(cineClubId);
    return this.tmdbFetch<TmdbMovieDetail>(
      `/movie/${tmdbId}`,
      { append_to_response: 'credits,videos' },
      apiKey,
    );
  }

  async getTvDetail(tmdbId: number, cineClubId?: number): Promise<TmdbTvDetail> {
    const apiKey = await this.getApiKeyForCineClub(cineClubId);
    return this.tmdbFetch<TmdbTvDetail>(
      `/tv/${tmdbId}`,
      { append_to_response: 'credits,videos' },
      apiKey,
    );
  }

  posterUrl(path: string | null): string | null {
    return path ? `${this.imageBaseUrl}/w500${path}` : null;
  }

  backdropUrl(path: string | null): string | null {
    return path ? `${this.imageBaseUrl}/w1280${path}` : null;
  }

  profileUrl(path: string | null): string | null {
    return path ? `${this.imageBaseUrl}/w185${path}` : null;
  }

  stillUrl(path: string | null): string | null {
    return path ? `${this.imageBaseUrl}/w300${path}` : null;
  }

  extractTrailerUrl(videos?: { results: { key: string; site: string; type: string }[] }): string | null {
    if (!videos?.results) return null;
    const trailer = videos.results.find(
      (v) => v.site === 'YouTube' && v.type === 'Trailer',
    );
    if (!trailer) {
      const teaser = videos.results.find(
        (v) => v.site === 'YouTube' && v.type === 'Teaser',
      );
      return teaser ? `https://www.youtube.com/watch?v=${teaser.key}` : null;
    }
    return `https://www.youtube.com/watch?v=${trailer.key}`;
  }
}
