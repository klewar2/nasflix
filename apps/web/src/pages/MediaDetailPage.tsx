import { useParams, Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, resolveApiUrl } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Copy, Download, ExternalLink, HardDrive, Loader2, Pencil, Trash2, Upload, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { NasBadge } from '@/components/badges/NasBadge';
import { JellyfinBadge } from '@/components/badges/JellyfinBadge';
import type { EpisodeResponse, MediaDetailResponse } from '@nasflix/shared';

type SeasonsSectionProps = {
  media: MediaDetailResponse;
  mediaTitle: string;
  isMember: boolean;
  nasOnline: boolean;
  loadingId: string | null;
  handleDownload: (fetchUrl: () => Promise<{ url: string }>, filename: string, key: string) => void;
};

const isEpOnNas = (ep: EpisodeResponse) => !!ep.nasPath && !ep.nasDeletedAt;
const isEpAvailable = (ep: EpisodeResponse) => isEpOnNas(ep) || !!ep.jellyfinItemId;

function SeasonsSection({ media, mediaTitle, isMember, nasOnline, loadingId, handleDownload }: SeasonsSectionProps) {
  // Sort seasons descending, keep only seasons that have at least one available episode
  const sortedSeasons = [...(media.seasons ?? [])]
    .sort((a, b) => b.seasonNumber - a.seasonNumber)
    .filter((s) => s.episodes?.some(isEpAvailable));
  const [activeSeasonId, setActiveSeasonId] = useState<number>(sortedSeasons[0]?.id);
  const activeSeason = sortedSeasons.find((s) => s.id === activeSeasonId) ?? sortedSeasons[0];

  if (!activeSeason) return null;

  return (
    <section className="mt-10">
      <h2 className="text-xl font-bold mb-4">Saisons</h2>

      <div className="flex gap-2 overflow-x-auto pb-2 mb-4 border-b border-zinc-800 scrollbar-thin">
        {sortedSeasons.map((s) => {
          const count = s.episodes?.filter(isEpAvailable).length ?? 0;
          const isActive = s.id === activeSeason.id;
          return (
            <button
              key={s.id}
              onClick={() => setActiveSeasonId(s.id)}
              className={`flex-shrink-0 px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                isActive
                  ? 'border-primary text-white'
                  : 'border-transparent text-zinc-400 hover:text-white'
              }`}
            >
              <span>Saison {s.seasonNumber}</span>
              {count > 0 && (
                <span className={`ml-2 text-xs ${isActive ? 'text-zinc-300' : 'text-zinc-500'}`}>
                  {count} ép.
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
        <div className="flex items-center gap-4 mb-4">
          {activeSeason.posterUrl && (
            <img src={activeSeason.posterUrl} alt={activeSeason.name ?? undefined} className="w-16 rounded flex-shrink-0" />
          )}
          <div className="flex-1">
            <h3 className="font-semibold">Saison {activeSeason.seasonNumber}</h3>
            {activeSeason.name && activeSeason.name !== `Saison ${activeSeason.seasonNumber}` && (
              <p className="text-sm text-zinc-400">{activeSeason.name}</p>
            )}
            {activeSeason.airDate && (
              <p className="text-xs text-zinc-500">{new Date(activeSeason.airDate).getFullYear()}</p>
            )}
            {activeSeason.overview && (
              <p className="text-xs text-zinc-400 mt-2 max-w-2xl leading-relaxed">{activeSeason.overview}</p>
            )}
          </div>
        </div>

        {activeSeason.episodes?.some(isEpAvailable) ? (
          <div className="space-y-1">
            {[...activeSeason.episodes]
              .filter(isEpAvailable)
              .sort((a, b) => a.episodeNumber - b.episodeNumber)
              .map((ep) => {
                const epKey = `ep-${ep.id}`;
                const epTitle = `${mediaTitle} — S${String(activeSeason.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')} ${ep.name ? `— ${ep.name}` : ''}`;
                const epOnNas = isEpOnNas(ep);
                const epOnJellyfin = !!ep.jellyfinItemId;
                const usesSeedbox = !epOnNas && epOnJellyfin;
                return (
                  <div
                    key={ep.id}
                    className="flex justify-between items-center text-sm py-2 px-2 rounded border-t border-zinc-800 hover:bg-zinc-800/50"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <HardDrive className={`w-3.5 h-3.5 flex-shrink-0 ${usesSeedbox ? 'text-blue-400' : 'text-emerald-400'}`} aria-label={usesSeedbox ? 'Disponible sur Jellyfin' : 'Disponible sur le NAS'} />
                      <span className="text-zinc-500 flex-shrink-0">E{String(ep.episodeNumber).padStart(2, '0')}</span>
                      <span className="truncate text-white">{ep.name || `Épisode ${ep.episodeNumber}`}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                      {ep.runtime && <span className="text-zinc-500 text-xs">{ep.runtime} min</span>}
                      {ep.nasFilename && (
                        <span className="text-[10px] text-zinc-600 truncate max-w-32 hidden lg:block" title={ep.nasFilename}>
                          {ep.nasFilename}
                        </span>
                      )}
                      {isMember && (epOnNas || epOnJellyfin) && (
                        <button
                          disabled={(epOnNas && !nasOnline) || loadingId === `dl-${epKey}`}
                          onClick={() => handleDownload(() => api.getEpisodeStreamUrl(ep.id, 'download'), ep.nasFilename || epTitle, `dl-${epKey}`)}
                          className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-zinc-400 hover:text-white transition-colors border border-zinc-700"
                          title="Télécharger"
                        >
                          {loadingId === `dl-${epKey}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Aucun épisode disponible pour cette saison.</p>
        )}
      </div>
    </section>
  );
}

export default function MediaDetailPage() {
  const { id } = useParams();
  const { cineClub } = useAuth();
  const isAdmin = cineClub?.role === 'ADMIN';
  const isMember = !!cineClub;

  const [copied, setCopied] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const { data: media, isLoading } = useQuery({
    queryKey: ['media', id],
    queryFn: () => api.getMediaById(Number(id)),
    enabled: !!id,
  });

  const { data: nasStatus } = useQuery({
    queryKey: ['nas-status'],
    queryFn: () => api.getNasStatus(),
    enabled: isMember,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const nasOnline = nasStatus?.online ?? false;

  const copyPath = () => {
    if (media?.nasPath) {
      navigator.clipboard.writeText(media.nasPath);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = async (fetchUrl: () => Promise<{ url: string }>, filename: string, key: string) => {
    setLoadingId(key);
    try {
      const { url } = await fetchUrl();
      const a = document.createElement('a');
      a.href = resolveApiUrl(url);
      a.download = filename;
      a.click();
    } catch {
      // silently fail
    } finally {
      setLoadingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="px-4 md:px-8 py-6">
        <Skeleton className="h-[50vh] w-full rounded-xl mb-6" />
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
    );
  }

  if (!media) {
    return (
      <div className="px-4 md:px-8 py-20 text-center">
        <p className="text-zinc-500">Média non trouvé</p>
        <Link to="/" className="text-primary hover:underline mt-4 inline-block">Retour</Link>
      </div>
    );
  }

  const directors = media.cast?.filter((c) => c.role === 'director') || [];
  const actors = media.cast?.filter((c) => c.role === 'actor') || [];
  const mediaTitle = media.titleVf || media.titleOriginal;

  return (
    <>
      <div className="pb-10">
        <div className="relative h-[50vh] md:h-[60vh]">
          <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${media.backdropUrl || ''})` }}>
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-zinc-950/30" />
          </div>
          <Link to="/" className="absolute top-4 left-4 z-10 text-zinc-400 hover:text-white">
            <ArrowLeft className="w-6 h-6" />
          </Link>
          {isAdmin && (
            <a
              href={`/admin/media/${id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute top-4 right-4 z-10 flex items-center gap-1.5 text-xs text-zinc-300 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
              Éditer
            </a>
          )}
        </div>

        <div className="px-4 md:px-8 -mt-32 relative z-10">
          <div className="flex flex-col md:flex-row gap-6">
            {media.posterUrl && (
              <img src={media.posterUrl} alt={mediaTitle} className="w-44 md:w-52 lg:w-60 rounded-lg shadow-2xl flex-shrink-0 hidden md:block self-start" />
            )}
            <div className="flex-1">
              <h1 className="text-3xl md:text-4xl font-bold mb-2">{mediaTitle}</h1>
              {media.titleVf && media.titleOriginal !== media.titleVf && (
                <p className="text-zinc-400 text-sm mb-3">{media.titleOriginal}</p>
              )}

              <div className="flex items-center gap-3 text-sm text-zinc-400 mb-4 flex-wrap">
                <Badge variant="secondary">{media.type === 'MOVIE' ? 'Film' : 'Série'}</Badge>
                {media.releaseYear && <span>{media.releaseYear}</span>}
                {media.voteAverage && <span>★ {media.voteAverage.toFixed(1)}</span>}
                {media.runtime && <span>{media.runtime} min</span>}
                {media.videoQuality === '4K' && (
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/40">4K UHD</span>
                )}
                {media.videoQuality === '1080p' && (
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/40">Full HD</span>
                )}
                {media.dolbyVision && (
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-gradient-to-r from-blue-700/40 to-blue-500/40 text-blue-200 border border-blue-500/40">DOLBY VISION</span>
                )}
                {media.hdr && !media.dolbyVision && (
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/40">HDR</span>
                )}
                {media.dolbyAtmos && (
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-indigo-600/30 text-indigo-200 border border-indigo-500/40">DOLBY ATMOS</span>
                )}
                {media.audioFormat && !media.dolbyAtmos && (
                  <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">{media.audioFormat}</span>
                )}
              </div>

              <div className="flex gap-2 flex-wrap mb-4">
                {media.genres?.map((g) => (
                  <Badge key={g.genre.id} variant="outline">{g.genre.name}</Badge>
                ))}
              </div>

              {media.overview && <p className="text-zinc-300 text-sm leading-relaxed max-w-2xl mb-6">{media.overview}</p>}

              {directors.length > 0 && (
                <p className="text-sm mb-4">
                  <span className="text-zinc-500">Réalisateur : </span>
                  {directors.map((d) => d.person.name).join(', ')}
                </p>
              )}

              {/* Download button — Movies only (series handled per-episode) */}
              {(() => {
                if (!isMember || media.type !== 'MOVIE') return null;
                const movieOnNas = media.sourceType === 'NAS' && !!media.nasPath && !media.nasDeletedAt;
                const movieOnJellyfin = !!media.jellyfinItemId;
                if (!movieOnNas && !movieOnJellyfin) return null;
                return (
                  <div className="flex items-center gap-3 mb-4 flex-wrap">
                    {/* Offline indicator */}
                    {!nasOnline && movieOnNas && (
                      <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                        <WifiOff className="w-3.5 h-3.5" />
                        NAS hors ligne
                      </span>
                    )}

                    <button
                      disabled={(movieOnNas && !nasOnline) || loadingId === `dl-${id}`}
                      onClick={() => handleDownload(() => api.getStreamUrl(Number(id), 'download'), media.nasFilename || mediaTitle, `dl-${id}`)}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-white text-sm transition-colors border border-zinc-700"
                    >
                      {loadingId === `dl-${id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                      Télécharger
                    </button>
                  </div>
                );
              })()}

              {/* Bloc Sources : badges NAS / Jellyfin + chemins + actions super admin */}
              <SourcesBlock media={media} onAction={() => { /* refetch handled by parent useQuery on focus */ }} />

              <div className="flex items-center gap-2 mt-4 p-3 bg-zinc-900 rounded-md border border-zinc-800">
                <code className="text-xs text-zinc-400 flex-1 truncate">{media.nasPath}</code>
                <button onClick={copyPath} className="text-zinc-500 hover:text-white flex-shrink-0">
                  {copied ? <span className="text-xs text-green-400">Copié !</span> : <Copy className="w-4 h-4" />}
                </button>
              </div>

              {media.trailerUrl && (() => {
                const key = (() => {
                  try { return new URL(media.trailerUrl).searchParams.get('v'); } catch { return null; }
                })();
                if (!key) return (
                  <a href={media.trailerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 mt-4 text-sm text-primary hover:underline">
                    <ExternalLink className="w-4 h-4" /> Voir la bande-annonce
                  </a>
                );
                return (
                  <div className="mt-6 max-w-2xl">
                    <h3 className="text-sm font-semibold text-zinc-400 mb-2 uppercase tracking-wider">Bande-annonce</h3>
                    <div className="relative aspect-video rounded-lg overflow-hidden bg-zinc-900">
                      <iframe
                        src={`https://www.youtube.com/embed/${key}?rel=0`}
                        className="absolute inset-0 w-full h-full"
                        allowFullScreen
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        title="Bande-annonce"
                      />
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {actors.length > 0 && (
            <section className="mt-10">
              <h2 className="text-xl font-bold mb-4">Casting</h2>
              <div className="flex gap-4 overflow-x-auto pb-4">
                {actors.map((a) => (
                  <div key={a.id} className="flex-shrink-0 w-28 text-center">
                    {a.person.photoUrl ? (
                      <img src={a.person.photoUrl} alt={a.person.name} className="w-20 h-20 rounded-full mx-auto object-cover" />
                    ) : (
                      <div className="w-20 h-20 rounded-full bg-zinc-800 mx-auto" />
                    )}
                    <p className="text-xs mt-2 font-medium truncate">{a.person.name}</p>
                    <p className="text-[10px] text-zinc-500 truncate">{a.character}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {media.seasons && media.seasons.length > 0 && (
            <SeasonsSection
              media={media}
              mediaTitle={mediaTitle}
              isMember={isMember}
              nasOnline={nasOnline}
              loadingId={loadingId}
              handleDownload={handleDownload}
            />
          )}
        </div>
      </div>
    </>
  );
}

function SourcesBlock({ media, onAction }: { media: MediaDetailResponse; onAction: () => void }) {
  const { user } = useAuth();
  const isSuperAdmin = !!user?.isSuperAdmin;
  const onNas = media.sourceType === 'NAS' && !media.nasDeletedAt;
  const onJellyfin = !!media.jellyfinItemId;
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const triggerTransfer = async () => {
    if (!confirm('Lancer le transfert de ce média vers le NAS ?')) return;
    setBusy('transfer');
    setMsg(null);
    try {
      const r = await api.triggerManualTransfer({ mediaId: media.id });
      setMsg(`Transfert lancé (job #${r.jobId})`);
      onAction();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(null);
    }
  };

  const triggerJellyfinDelete = async () => {
    if (!confirm('Supprimer ce média de Jellyfin ? (NAS et seedbox ne sont pas affectés)')) return;
    setBusy('del-jf');
    setMsg(null);
    try {
      const r = await api.triggerJellyfinDelete(media.id);
      setMsg(`Suppression Jellyfin programmée (job #${r.jobId})`);
      onAction();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-4 p-3 bg-zinc-900 rounded-md border border-zinc-800 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-zinc-500">Sources :</span>
        {onNas && <NasBadge nasPath={media.nasPath} />}
        {media.nasDeletedAt && !onNas && <NasBadge nasPath={media.nasPath} deleted />}
        {onJellyfin && <JellyfinBadge jellyfinItemId={media.jellyfinItemId} />}
        {!onNas && !onJellyfin && !media.nasDeletedAt && (
          <span className="text-xs text-zinc-500">Aucune source connue</span>
        )}
      </div>
      {media.nasDeletedAt && (
        <p className="text-xs text-amber-500">
          ⚠️ Fichier supprimé du NAS le {new Date(media.nasDeletedAt).toLocaleString('fr-FR')} — nettoyage seedbox planifié
        </p>
      )}
      {isSuperAdmin && (
        <div className="flex flex-wrap gap-2 pt-1">
          {!onNas && onJellyfin && (
            <button
              disabled={busy === 'transfer'}
              onClick={triggerTransfer}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-xs text-white"
            >
              {busy === 'transfer' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Télécharger sur le NAS
            </button>
          )}
          {onJellyfin && (
            <button
              disabled={busy === 'del-jf'}
              onClick={triggerJellyfinDelete}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-violet-800 hover:bg-violet-700 disabled:opacity-40 text-xs text-white"
            >
              {busy === 'del-jf' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Supprimer de Jellyfin
            </button>
          )}
        </div>
      )}
      {msg && <p className="text-xs text-zinc-300">{msg}</p>}
    </div>
  );
}
