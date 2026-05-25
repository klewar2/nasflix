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

function formatLibrary(library: LibraryItem[]): string {
  if (!library.length) return '(bibliothèque vide)';
  return library
    .slice(0, 200)
    .map((m) => `- [${m.type === 'MOVIE' ? 'Film' : 'Série'}] ${m.title}${m.year ? ` (${m.year})` : ''} — ${m.genres.join(', ') || 'genres inconnus'}`)
    .join('\n');
}

function formatFeedback(feedback: FeedbackSummary): string {
  const parts: string[] = [];
  if (feedback.liked.length) {
    parts.push(`AIMÉS (poursuivre dans cette direction) : ${feedback.liked.slice(0, 30).join(' · ')}`);
  }
  if (feedback.disliked.length) {
    parts.push(`REJETÉS (à éviter, ainsi que tout ce qui leur ressemble fortement) : ${feedback.disliked.slice(0, 30).join(' · ')}`);
  }
  if (feedback.seen.length) {
    parts.push(`DÉJÀ VUS (NE JAMAIS proposer à nouveau) : ${feedback.seen.slice(0, 30).join(' · ')}`);
  }
  return parts.length ? parts.join('\n') : '(aucun retour utilisateur pour le moment — base-toi uniquement sur la bibliothèque)';
}

export function buildPastPrompt(library: LibraryItem[], feedback: FeedbackSummary, targetCount: number): string {
  return `Tu es un expert en cinéma et séries qui recommande des œuvres à un cineclub privé.

## Bibliothèque actuelle du cineclub
${formatLibrary(library)}

## Retours sur les recommandations précédentes
${formatFeedback(feedback)}

## Mission
Recommande EXACTEMENT ${targetCount} films ou séries (mélange libre selon ce qui colle au profil) déjà sortis et bien établis. **Ni plus, ni moins** : le tableau "recommendations" doit contenir précisément ${targetCount} entrées.

## Règles ABSOLUES (non négociables)
1. **Le tableau "recommendations" doit contenir EXACTEMENT ${targetCount} éléments.** Pas ${targetCount - 1}, pas ${targetCount + 1}.
2. **Aucun titre déjà dans la bibliothèque ci-dessus.** Vérifie chaque titre proposé contre la liste.
3. **Aucun titre marqué DÉJÀ VU ou REJETÉ** dans le bloc retours.
4. **Pas d'invention de genre** : si tu n'es pas certain du genre d'un film, ne le propose pas. Ne tords jamais la description pour faire matcher avec un goût du cineclub.
5. **Ne te limite pas à reproduire les genres dominants** de la bibliothèque. Cherche aussi la cohérence de ton, de thèmes, de réalisateurs, d'époque, d'ambiance.

## Stratégie attendue
- Identifie les patterns réels dans la bibliothèque : réalisateurs récurrents, genres principaux ET secondaires, époques, sensibilités (cérébral / fun / contemplatif / etc.).
- Si du feedback existe : pondère fortement. Un LIKE signale une direction validée à creuser ; un DISLIKE signale un faux positif à éviter (même style/genre).
- Privilégie des œuvres reconnues (bonne note critique, cultes, ou très bien évaluées sur les bases de données publiques).
- La justification doit citer un ou plusieurs titres précis de la bibliothèque ou du feedback pour ancrer la reco.

## Format de la justification (champ "reason")
- 1 à 3 phrases.
- Mentionne au moins un titre concret de la bibliothèque/feedback ET le lien spécifique (réalisateur, ton, thème, ambiance — pas juste "genre horreur").
- N'invente AUCUN détail sur le film recommandé que tu n'es pas certain à 100%. Si tu hésites sur un fait, reformule sans ce fait.

Réponds UNIQUEMENT en appelant l'outil "submit_recommendations".`;
}

export function buildUpcomingPrompt(
  library: LibraryItem[],
  feedback: FeedbackSummary,
  upcoming: UpcomingCandidate[],
  targetCount: number,
): string {
  const upcomingList = upcoming.slice(0, 40)
    .map((u, i) => {
      const header = `${i + 1}. [${u.type === 'MOVIE' ? 'Film' : 'Série'}] "${u.title}"${u.releaseDate ? ` — sortie ${u.releaseDate}` : ''}`;
      const genreLine = u.genres.length ? `   Genres TMDB : ${u.genres.join(', ')}` : '   Genres TMDB : (inconnus)';
      const overviewLine = `   Synopsis : ${u.overview ? u.overview.slice(0, 350) : '(aucun synopsis fourni)'}`;
      return `${header}\n${genreLine}\n${overviewLine}`;
    })
    .join('\n\n');

  return `Tu es un expert en cinéma et séries qui sélectionne des sorties à venir pour un cineclub privé.

## Bibliothèque actuelle du cineclub
${formatLibrary(library)}

## Retours sur les recommandations précédentes
${formatFeedback(feedback)}

## Catalogue des sorties à venir (source : TMDB, dates dans le futur garanties)
${upcomingList}

## Mission
Sélectionne EXACTEMENT ${targetCount} titres **STRICTEMENT** parmi la liste ci-dessus, ceux qui matchent le mieux les goûts du cineclub. **Ni plus, ni moins** : le tableau "recommendations" doit contenir précisément ${targetCount} entrées.

## Règles ABSOLUES (non négociables)
1. **Le tableau "recommendations" doit contenir EXACTEMENT ${targetCount} éléments.** Pas ${targetCount - 1}, pas ${targetCount + 1}.
2. **Tu DOIS choisir uniquement parmi les ${upcoming.length} titres de la liste « Catalogue des sorties à venir » ci-dessus.** Recopie le titre EXACTEMENT comme écrit dans la liste (entre guillemets), sans modification.
3. **Tu n'as pas le droit d'inventer le genre ou les thèmes d'un titre.** Tu ne connais ces films/séries QUE par les genres TMDB et le synopsis fournis. Si le synopsis ne dit pas que c'est de l'horreur, ce n'est PAS un film d'horreur — quelles que soient les apparences du titre.
4. **Aucun titre DÉJÀ VU ou REJETÉ** dans le feedback.
5. **La justification doit citer un fait précis du synopsis OU des genres TMDB fournis** dans la liste. Si tu ne peux pas justifier sans inventer, ne propose pas ce titre.

## Stratégie attendee
- Pour chaque candidat : lis attentivement son synopsis et ses genres TMDB.
- Compare aux patterns réels de la bibliothèque (genres dominants, ton, thèmes) et au feedback.
- Ne force pas un match : si aucun candidat ne correspond aux goûts du cineclub, propose ceux qui s'en rapprochent le plus honnêtement, sans déformer leur nature.
- Privilégie la diversité : ne propose pas 5 films du même genre si la bibliothèque est variée.

## Format de la justification (champ "reason")
- 1 à 3 phrases.
- Cite un élément du synopsis ou un genre TMDB fourni POUR ce titre.
- Établis le lien avec un titre précis de la bibliothèque ou du feedback du cineclub.
- N'extrapole jamais au-delà des informations fournies dans la liste.

## Champs requis
- "title" : copie exacte du titre de la liste (sans les guillemets).
- "type" : MOVIE ou TV selon le tag de la liste.
- "year" : année extraite de la date de sortie.
- "reason" : justification respectant les règles ci-dessus.

Réponds UNIQUEMENT en appelant l'outil "submit_recommendations".`;
}
