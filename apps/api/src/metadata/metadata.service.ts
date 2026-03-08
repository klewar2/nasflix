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
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  private async getApiKey(): Promise<string> {
    // Try DB first, then env var
    const config = await this.prisma.apiConfig.findFirst({
      where: { provider: 'tmdb', isActive: true },
    });
    if (config) return config.apiKey;

    const envKey = this.configService.get<string>('TMDB_API_KEY');
    if (envKey) return envKey;

    throw new Error('No TMDB API key configured');
  }

  private async tmdbFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const apiKey = await this.getApiKey();
    const url = new URL(`https://api.themoviedb.org/3${path}`);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('language', 'fr-FR');
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`TMDB API error: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  async searchMulti(query: string, year?: number): Promise<TmdbSearchResult[]> {
    const params: Record<string, string> = { query };
    if (year) params.year = String(year);

    const result = await this.tmdbFetch<{ results: TmdbSearchResult[] }>(
      '/search/multi',
      params,
    );

    return result.results.filter(
      (r) => r.media_type === 'movie' || r.media_type === 'tv',
    );
  }

  async searchMovie(query: string, year?: number): Promise<TmdbSearchResult[]> {
    const params: Record<string, string> = { query };
    if (year) params.year = String(year);

    const result = await this.tmdbFetch<{ results: TmdbSearchResult[] }>('/search/movie', params);
    return result.results;
  }

  async searchTv(query: string, year?: number): Promise<TmdbSearchResult[]> {
    const params: Record<string, string> = { query };
    if (year) params.first_air_date_year = String(year);

    const result = await this.tmdbFetch<{ results: TmdbSearchResult[] }>('/search/tv', params);
    return result.results;
  }

  async getMovieDetail(tmdbId: number): Promise<TmdbMovieDetail> {
    return this.tmdbFetch<TmdbMovieDetail>(
      `/movie/${tmdbId}`,
      { append_to_response: 'credits,videos' },
    );
  }

  async getTvDetail(tmdbId: number): Promise<TmdbTvDetail> {
    return this.tmdbFetch<TmdbTvDetail>(
      `/tv/${tmdbId}`,
      { append_to_response: 'credits,videos' },
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

  async updateApiConfig(provider: string, apiKey: string, baseUrl?: string) {
    return this.prisma.apiConfig.upsert({
      where: { provider },
      update: { apiKey, ...(baseUrl ? { baseUrl } : {}) },
      create: {
        provider,
        apiKey,
        baseUrl: baseUrl || 'https://api.themoviedb.org/3',
      },
    });
  }

  async getApiConfigs() {
    const configs = await this.prisma.apiConfig.findMany();
    return configs.map((c) => ({
      ...c,
      apiKey: c.apiKey.slice(0, 4) + '***',
    }));
  }
}
