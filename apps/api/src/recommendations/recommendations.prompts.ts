export interface LibraryItem {
  title: string;
  year: number | null;
  type: 'MOVIE' | 'TV';
  genres: string[];
}

export interface FeedbackSummary {
  liked: string[];
  disliked: string[];
  seen: string[];
}

export interface UpcomingCandidate {
  title: string;
  type: 'MOVIE' | 'TV';
  releaseDate: string | null;
  overview: string;
  genres: string[];
}

const TARGET_COUNT = 5;

function formatLibrary(library: LibraryItem[]): string {
  if (!library.length) return '(bibliothèque vide)';
  return library
    .slice(0, 200)
    .map((m) => `- [${m.type === 'MOVIE' ? 'Film' : 'Série'}] ${m.title}${m.year ? ` (${m.year})` : ''} — ${m.genres.join(', ') || 'genres inconnus'}`)
    .join('\n');
}

function formatFeedback(feedback: FeedbackSummary): string {
  const parts: string[] = [];
  if (feedback.liked.length) parts.push(`Aimés : ${feedback.liked.slice(0, 30).join(', ')}`);
  if (feedback.disliked.length) parts.push(`Rejetés : ${feedback.disliked.slice(0, 30).join(', ')}`);
  if (feedback.seen.length) parts.push(`Déjà vus : ${feedback.seen.slice(0, 30).join(', ')}`);
  return parts.length ? parts.join('\n') : '(aucun retour utilisateur pour le moment)';
}

export function buildPastPrompt(library: LibraryItem[], feedback: FeedbackSummary): string {
  return `Tu es un assistant qui recommande des films et séries à un cineclub privé.

Voici la bibliothèque actuelle du cineclub :
${formatLibrary(library)}

Retours du cineclub sur des recommandations précédentes :
${formatFeedback(feedback)}

Mission :
- Recommande exactement ${TARGET_COUNT} films/séries qui ressemblent aux goûts visibles dans cette bibliothèque.
- N'inclus AUCUN titre déjà présent dans la bibliothèque ci-dessus.
- Privilégie ce que le cineclub a aimé. Évite ce qui ressemble à ce qu'il a rejeté.
- Mélange films et séries selon ce qui colle le mieux au profil.
- Privilégie des œuvres bien notées, avec une bonne renommée critique ou culte.
- Pour chaque reco, donne une justification courte (1-3 phrases) qui s'appuie sur les éléments visibles de la bibliothèque.

Réponds UNIQUEMENT en appelant l'outil "submit_recommendations" avec la structure attendue.`;
}

export function buildUpcomingPrompt(
  library: LibraryItem[],
  feedback: FeedbackSummary,
  upcoming: UpcomingCandidate[],
): string {
  const upcomingList = upcoming.slice(0, 40)
    .map((u) => `- [${u.type === 'MOVIE' ? 'Film' : 'Série'}] ${u.title}${u.releaseDate ? ` (sortie ${u.releaseDate})` : ''} — ${u.genres.join(', ') || 'genres inconnus'}\n  ${u.overview.slice(0, 200)}`)
    .join('\n');

  return `Tu es un assistant qui recommande des sorties à venir à un cineclub privé.

Voici la bibliothèque actuelle du cineclub :
${formatLibrary(library)}

Retours du cineclub sur des recommandations précédentes :
${formatFeedback(feedback)}

Voici les sorties à venir disponibles dans le catalogue TMDB :
${upcomingList}

Mission :
- Sélectionne exactement ${TARGET_COUNT} titres parmi la liste des sorties à venir ci-dessus, qui correspondent le mieux aux goûts du cineclub.
- Tu DOIS choisir UNIQUEMENT parmi les titres de la liste des sorties à venir — ne propose aucun autre film/série.
- Privilégie ce que le cineclub a aimé. Évite ce qui ressemble à ce qu'il a rejeté.
- Pour chaque reco, justifie en t'appuyant sur des éléments visibles de la bibliothèque.

Réponds UNIQUEMENT en appelant l'outil "submit_recommendations" avec la structure attendue.`;
}
