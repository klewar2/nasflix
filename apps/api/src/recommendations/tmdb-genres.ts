/**
 * Mapping local TMDB genre_id → nom FR.
 *
 * Dupliqué depuis `packages/shared/src/constants/genres.ts` pour éviter
 * d'importer depuis `@nasflix/shared` côté API : le package shared n'a pas
 * de build (`main` pointe sur du `.ts` source) et casse en runtime Node
 * ESM en production (cf. crash Railway). Garder ce mapping localement
 * isole le backend de cette contrainte.
 *
 * À synchroniser manuellement si la liste TMDB évolue dans shared.
 */

export const TMDB_MOVIE_GENRES: Record<number, string> = {
  28: 'Action',
  12: 'Aventure',
  16: 'Animation',
  35: 'Comédie',
  80: 'Crime',
  99: 'Documentaire',
  18: 'Drame',
  10751: 'Familial',
  14: 'Fantastique',
  36: 'Histoire',
  27: 'Horreur',
  10402: 'Musique',
  9648: 'Mystère',
  10749: 'Romance',
  878: 'Science-Fiction',
  10770: 'Téléfilm',
  53: 'Thriller',
  10752: 'Guerre',
  37: 'Western',
};

export const TMDB_TV_GENRES: Record<number, string> = {
  10759: 'Action & Aventure',
  16: 'Animation',
  35: 'Comédie',
  80: 'Crime',
  99: 'Documentaire',
  18: 'Drame',
  10751: 'Familial',
  10762: 'Enfants',
  9648: 'Mystère',
  10763: 'Actualités',
  10764: 'Télé-réalité',
  10765: 'Science-Fiction & Fantastique',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'Guerre & Politique',
  37: 'Western',
};
