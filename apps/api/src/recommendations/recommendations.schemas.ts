import { z } from 'zod';

export const RECOMMENDATIONS_PROMPT_VERSION = 'v1';

export const RecommendationItemSchema = z.object({
  title: z.string().min(1),
  type: z.enum(['MOVIE', 'TV']),
  year: z.number().int().min(1900).max(2100).optional(),
  reason: z.string().min(20).max(600),
});

export const RecommendationResponseSchema = z.object({
  recommendations: z.array(RecommendationItemSchema).min(1).max(10),
});

export type RecommendationItem = z.infer<typeof RecommendationItemSchema>;
export type RecommendationResponse = z.infer<typeof RecommendationResponseSchema>;

/**
 * JSON Schema dérivé manuellement (évite d'ajouter `zod-to-json-schema` comme dépendance).
 * Utilisé pour le `input_schema` du tool Claude.
 */
export const RECOMMENDATIONS_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    recommendations: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Titre exact du film ou de la série, en français de préférence' },
          type: { type: 'string', enum: ['MOVIE', 'TV'], description: 'MOVIE pour un film, TV pour une série' },
          year: { type: 'integer', description: "Année de sortie (pour désambiguïser les remakes)" },
          reason: { type: 'string', description: "Justification (1-3 phrases) expliquant pourquoi cette reco match le cineclub" },
        },
        required: ['title', 'type', 'reason'],
      },
    },
  },
  required: ['recommendations'],
} as const;
