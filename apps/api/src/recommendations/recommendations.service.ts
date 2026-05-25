import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import {
  FeedbackVote,
  Recommendation,
  RecommendationType,
  TmdbMediaType,
} from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { MetadataService, TmdbSearchResult } from '../metadata/metadata.service';
import { TMDB_MOVIE_GENRES, TMDB_TV_GENRES } from './tmdb-genres';
import {
  RECOMMENDATIONS_PROMPT_VERSION,
  RECOMMENDATIONS_TOOL_SCHEMA,
  RecommendationItem,
  RecommendationResponseSchema,
} from './recommendations.schemas';
import {
  buildPastPrompt,
  buildUpcomingPrompt,
  FeedbackSummary,
  LibraryItem,
  UpcomingCandidate,
} from './recommendations.prompts';

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const ALLOWED_COUNTS = [5, 10, 15, 20] as const;
const DEFAULT_COUNT = 5;

function normalizeCount(value: number | null | undefined): number {
  if (!value) return DEFAULT_COUNT;
  return (ALLOWED_COUNTS as readonly number[]).includes(value) ? value : DEFAULT_COUNT;
}

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly metadata: MetadataService,
  ) {}

  private async getCineclubConfig(cineClubId: number): Promise<{ client: Anthropic; targetCount: number }> {
    const club = await this.prisma.cineClub.findUnique({
      where: { id: cineClubId },
      select: { anthropicApiKey: true, recommendationsEnabled: true, recommendationsCount: true },
    });
    if (!club) throw new NotFoundException('CineClub introuvable');
    if (!club.recommendationsEnabled) {
      throw new BadRequestException('Les recommandations IA sont désactivées pour ce CineClub');
    }
    if (!club.anthropicApiKey) {
      throw new BadRequestException("Aucune clé API Claude configurée pour ce CineClub");
    }
    const apiKey = this.crypto.decrypt(club.anthropicApiKey);
    return {
      client: new Anthropic({ apiKey }),
      targetCount: normalizeCount(club.recommendationsCount),
    };
  }

  private async getLibrarySummary(cineClubId: number): Promise<LibraryItem[]> {
    const media = await this.prisma.media.findMany({
      where: { cineClubId },
      select: {
        titleVf: true,
        titleOriginal: true,
        type: true,
        releaseYear: true,
        genres: { include: { genre: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return media.map((m) => ({
      title: m.titleVf || m.titleOriginal,
      year: m.releaseYear,
      type: m.type === 'MOVIE' ? 'MOVIE' : 'TV',
      genres: m.genres.map((g) => g.genre.name),
    }));
  }

  private async getFeedbackSummary(cineClubId: number): Promise<FeedbackSummary> {
    const feedbacks = await this.prisma.recommendationFeedback.findMany({
      where: { cineClubId },
      select: { vote: true, title: true },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    const summary: FeedbackSummary = { liked: [], disliked: [], seen: [] };
    for (const f of feedbacks) {
      if (f.vote === FeedbackVote.LIKE) summary.liked.push(f.title);
      else if (f.vote === FeedbackVote.DISLIKE) summary.disliked.push(f.title);
      else if (f.vote === FeedbackVote.SEEN) summary.seen.push(f.title);
    }
    return summary;
  }

  private async callClaude(client: Anthropic, prompt: string): Promise<RecommendationItem[]> {
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      tools: [
        {
          name: 'submit_recommendations',
          description: 'Soumet la liste finale de recommandations.',
          input_schema: RECOMMENDATIONS_TOOL_SCHEMA as unknown as Anthropic.Messages.Tool.InputSchema,
        },
      ],
      tool_choice: { type: 'tool', name: 'submit_recommendations' },
      messages: [{ role: 'user', content: prompt }],
    });

    const toolUse = response.content.find((c) => c.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error('Réponse Claude invalide : aucun tool_use détecté');
    }
    const parsed = RecommendationResponseSchema.parse(toolUse.input);
    return parsed.recommendations;
  }

  /**
   * Hydrate une reco avec les métadonnées TMDB (poster, backdrop, trailer, vote moyen, releaseDate).
   * Retourne null si aucun match TMDB.
   */
  private async hydrateFromTmdb(
    item: RecommendationItem,
    cineClubId: number,
  ): Promise<{
    tmdbId: number;
    tmdbType: TmdbMediaType;
    title: string;
    overview: string | null;
    posterUrl: string | null;
    backdropUrl: string | null;
    trailerUrl: string | null;
    releaseDate: Date | null;
    voteAverage: number | null;
    genres: string[];
  } | null> {
    let candidates: TmdbSearchResult[] = [];
    if (item.type === 'MOVIE') {
      candidates = await this.metadata.searchMovie(item.title, item.year, cineClubId);
    } else {
      candidates = await this.metadata.searchTv(item.title, item.year, cineClubId);
    }
    const match = candidates[0];
    if (!match) return null;

    try {
      if (item.type === 'MOVIE') {
        const detail = await this.metadata.getMovieDetail(match.id, cineClubId);
        return {
          tmdbId: detail.id,
          tmdbType: TmdbMediaType.MOVIE,
          title: detail.title || item.title,
          overview: detail.overview || null,
          posterUrl: this.metadata.posterUrl(detail.poster_path),
          backdropUrl: this.metadata.backdropUrl(detail.backdrop_path),
          trailerUrl: this.metadata.extractTrailerUrl(detail.videos),
          releaseDate: detail.release_date ? new Date(detail.release_date) : null,
          voteAverage: detail.vote_average ?? null,
          genres: detail.genres?.map((g) => g.name) ?? [],
        };
      }
      const detail = await this.metadata.getTvDetail(match.id, cineClubId);
      return {
        tmdbId: detail.id,
        tmdbType: TmdbMediaType.TV,
        title: detail.name || item.title,
        overview: detail.overview || null,
        posterUrl: this.metadata.posterUrl(detail.poster_path),
        backdropUrl: this.metadata.backdropUrl(detail.backdrop_path),
        trailerUrl: this.metadata.extractTrailerUrl(detail.videos),
        releaseDate: detail.first_air_date ? new Date(detail.first_air_date) : null,
        voteAverage: detail.vote_average ?? null,
        genres: detail.genres?.map((g) => g.name) ?? [],
      };
    } catch (err) {
      this.logger.warn(`[hydrate] échec TMDB detail pour "${item.title}": ${err}`);
      return null;
    }
  }

  /**
   * Set des `<TYPE>:<tmdbId>` à exclure :
   * - médias déjà présents dans la bibliothèque
   * - titres ayant reçu un feedback SEEN ou DISLIKE (par n'importe quel membre du cineclub)
   */
  private async getExcludedTmdbIds(cineClubId: number): Promise<Set<string>> {
    const [media, feedbacks] = await Promise.all([
      this.prisma.media.findMany({
        where: { cineClubId, tmdbId: { not: null } },
        select: { type: true, tmdbId: true },
      }),
      this.prisma.recommendationFeedback.findMany({
        where: { cineClubId, vote: { in: [FeedbackVote.SEEN, FeedbackVote.DISLIKE] } },
        select: { tmdbType: true, tmdbId: true },
      }),
    ]);
    const excluded = new Set<string>();
    for (const m of media) excluded.add(`${m.type === 'MOVIE' ? 'MOVIE' : 'TV'}:${m.tmdbId}`);
    for (const f of feedbacks) excluded.add(`${f.tmdbType}:${f.tmdbId}`);
    return excluded;
  }

  async generatePast(cineClubId: number): Promise<Recommendation[]> {
    const { client, targetCount } = await this.getCineclubConfig(cineClubId);
    const [library, feedback, excludedIds] = await Promise.all([
      this.getLibrarySummary(cineClubId),
      this.getFeedbackSummary(cineClubId),
      this.getExcludedTmdbIds(cineClubId),
    ]);

    const prompt = buildPastPrompt(library, feedback, targetCount);
    const items = await this.callClaude(client, prompt);

    const batchId = randomUUID();
    const hydrated: Array<Awaited<ReturnType<typeof this.hydrateFromTmdb>>> = [];
    for (const item of items) {
      const h = await this.hydrateFromTmdb(item, cineClubId);
      if (!h) continue;
      const key = `${h.tmdbType}:${h.tmdbId}`;
      if (excludedIds.has(key)) continue; // bibliothèque ou DISLIKE/SEEN
      if (hydrated.some((x) => x && x.tmdbType === h.tmdbType && x.tmdbId === h.tmdbId)) continue; // doublon dans le batch
      hydrated.push(h);
      if (hydrated.length >= targetCount) break;
    }

    return this.replaceBatch(cineClubId, RecommendationType.PAST, batchId, hydrated, items);
  }

  async generateUpcoming(cineClubId: number): Promise<Recommendation[]> {
    const { client, targetCount } = await this.getCineclubConfig(cineClubId);
    const [library, feedback, excludedIds, upcomingMovies, onAirTv] = await Promise.all([
      this.getLibrarySummary(cineClubId),
      this.getFeedbackSummary(cineClubId),
      this.getExcludedTmdbIds(cineClubId),
      this.metadata.getUpcomingMovies(cineClubId).catch(() => []),
      this.metadata.getOnTheAirTv(cineClubId).catch(() => []),
    ]);

    // Filtre uniquement les titres dont la date de sortie est dans le futur
    // (TMDB /upcoming retourne aussi des sorties récentes déjà passées)
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const futureCandidates = [...upcomingMovies, ...onAirTv].filter((c) => {
      const dateStr = c.release_date || c.first_air_date;
      if (!dateStr) return false;
      const date = new Date(dateStr);
      return !isNaN(date.getTime()) && date >= now;
    });

    if (futureCandidates.length === 0) {
      this.logger.warn(`[generateUpcoming] cineClub#${cineClubId} : aucun candidat TMDB à venir`);
      return [];
    }

    // Tri par date croissante + cap à 40
    futureCandidates.sort((a, b) => {
      const da = new Date(a.release_date || a.first_air_date || '').getTime();
      const db = new Date(b.release_date || b.first_air_date || '').getTime();
      return da - db;
    });

    const upcomingForPrompt: UpcomingCandidate[] = futureCandidates.slice(0, 40).map((c) => {
      const isMovie = c.media_type === 'movie';
      const genreMap = isMovie ? TMDB_MOVIE_GENRES : TMDB_TV_GENRES;
      const genres = (c.genre_ids ?? [])
        .map((id) => genreMap[id])
        .filter((g): g is string => !!g);
      return {
        title: (c.title || c.name) ?? '',
        type: isMovie ? 'MOVIE' : 'TV',
        releaseDate: c.release_date || c.first_air_date || null,
        overview: c.overview || '',
        genres,
      };
    });

    const prompt = buildUpcomingPrompt(library, feedback, upcomingForPrompt, targetCount);
    const items = await this.callClaude(client, prompt);

    const batchId = randomUUID();
    const hydrated: Array<Awaited<ReturnType<typeof this.hydrateFromTmdb>>> = [];
    for (const item of items) {
      const h = await this.hydrateFromTmdb(item, cineClubId);
      if (!h) continue;
      const key = `${h.tmdbType}:${h.tmdbId}`;
      if (excludedIds.has(key)) continue;
      if (hydrated.some((x) => x && x.tmdbType === h.tmdbType && x.tmdbId === h.tmdbId)) continue;
      hydrated.push(h);
      if (hydrated.length >= targetCount) break;
    }

    return this.replaceBatch(cineClubId, RecommendationType.UPCOMING, batchId, hydrated, items);
  }

  /** Supprime les anciennes recos du même type pour ce cineclub, insère la nouvelle batch. */
  private async replaceBatch(
    cineClubId: number,
    type: RecommendationType,
    batchId: string,
    hydrated: Array<Awaited<ReturnType<typeof this.hydrateFromTmdb>>>,
    rawItems: RecommendationItem[],
  ): Promise<Recommendation[]> {
    const validHydrated = hydrated.filter((h): h is NonNullable<typeof h> => h !== null);
    if (validHydrated.length === 0) {
      this.logger.warn(`[replaceBatch] cineClub#${cineClubId} ${type} : aucune reco hydratée`);
      return [];
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.recommendation.deleteMany({ where: { cineClubId, type } });

      const inserted: Recommendation[] = [];
      for (let i = 0; i < validHydrated.length; i++) {
        const h = validHydrated[i];
        const raw = rawItems[i];
        const row = await tx.recommendation.create({
          data: {
            cineClubId,
            batchId,
            type,
            tmdbId: h.tmdbId,
            tmdbType: h.tmdbType,
            title: h.title,
            overview: h.overview,
            posterUrl: h.posterUrl,
            backdropUrl: h.backdropUrl,
            trailerUrl: h.trailerUrl,
            releaseDate: h.releaseDate,
            voteAverage: h.voteAverage,
            genres: h.genres,
            reasonText: raw?.reason ?? '',
          },
        });
        inserted.push(row);
      }
      this.logger.log(`[replaceBatch] cineClub#${cineClubId} ${type} (prompt ${RECOMMENDATIONS_PROMPT_VERSION}) : ${inserted.length} recos enregistrées`);
      return inserted;
    });
  }

  async listForCineclub(
    cineClubId: number,
    type: RecommendationType,
    userId: number,
  ): Promise<Array<Recommendation & { userVote: FeedbackVote | null }>> {
    const items = await this.prisma.recommendation.findMany({
      where: { cineClubId, type },
      orderBy: [{ voteAverage: 'desc' }, { createdAt: 'desc' }],
      include: {
        feedback: { where: { userId }, select: { vote: true } },
      },
    });
    return items.map(({ feedback, ...rest }) => ({
      ...rest,
      userVote: feedback[0]?.vote ?? null,
    }));
  }

  async getById(
    recommendationId: number,
    cineClubId: number,
    userId: number,
  ): Promise<Recommendation & { userVote: FeedbackVote | null }> {
    const reco = await this.prisma.recommendation.findFirst({
      where: { id: recommendationId, cineClubId },
      include: { feedback: { where: { userId }, select: { vote: true } } },
    });
    if (!reco) throw new NotFoundException('Recommandation introuvable');
    const { feedback, ...rest } = reco;
    return { ...rest, userVote: feedback[0]?.vote ?? null };
  }

  async setFeedback(
    recommendationId: number,
    userId: number,
    cineClubId: number,
    vote: FeedbackVote,
  ) {
    const reco = await this.prisma.recommendation.findFirst({
      where: { id: recommendationId, cineClubId },
    });
    if (!reco) throw new NotFoundException('Recommandation introuvable');

    return this.prisma.recommendationFeedback.upsert({
      where: {
        cineClubId_userId_tmdbId_tmdbType: {
          cineClubId,
          userId,
          tmdbId: reco.tmdbId,
          tmdbType: reco.tmdbType,
        },
      },
      create: {
        recommendationId: reco.id,
        userId,
        cineClubId,
        tmdbId: reco.tmdbId,
        tmdbType: reco.tmdbType,
        title: reco.title,
        vote,
      },
      update: { vote, recommendationId: reco.id },
    });
  }

  async clearFeedback(recommendationId: number, userId: number, cineClubId: number) {
    const reco = await this.prisma.recommendation.findFirst({
      where: { id: recommendationId, cineClubId },
    });
    if (!reco) throw new NotFoundException('Recommandation introuvable');
    await this.prisma.recommendationFeedback.deleteMany({
      where: {
        cineClubId,
        userId,
        tmdbId: reco.tmdbId,
        tmdbType: reco.tmdbType,
      },
    });
  }
}
