export const RECOMMENDATION_TYPES = ['PAST', 'UPCOMING'] as const;
export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];

export const TMDB_MEDIA_TYPES = ['MOVIE', 'TV'] as const;
export type TmdbMediaType = (typeof TMDB_MEDIA_TYPES)[number];

export const FEEDBACK_VOTES = ['LIKE', 'DISLIKE', 'SEEN'] as const;
export type FeedbackVote = (typeof FEEDBACK_VOTES)[number];

export interface RecommendationResponse {
  id: number;
  cineClubId: number;
  batchId: string;
  type: RecommendationType;
  tmdbId: number;
  tmdbType: TmdbMediaType;
  title: string;
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  trailerUrl: string | null;
  releaseDate: string | null;
  voteAverage: number | null;
  genres: string[];
  reasonText: string;
  createdAt: string;
  userVote: FeedbackVote | null;
}

