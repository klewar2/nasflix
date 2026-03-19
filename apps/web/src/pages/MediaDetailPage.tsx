import { useParams, Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { VideoPlayerModal } from '@/components/media/VideoPlayerModal';
import { ArrowLeft, Copy, Download, ExternalLink, HardDrive, Loader2, Pencil, Play, WifiOff } from 'lucide-react';
import { useState } from 'react';

export default function MediaDetailPage() {
  const { id } = useParams();
  const { cineClub } = useAuth();
  const isAdmin = cineClub?.role === 'ADMIN';
  const isMember = !!cineClub;

  const [copied, setCopied] = useState(false);
  const [player, setPlayer] = useState<{ url: string; title: string; isHls: boolean; durationSeconds: number } | null>(null);
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

  const openPlayer = async (fetchUrl: () => Promise<{ url: string; isHls: boolean; durationSeconds: number }>, title: string, key: string) => {
    setLoadingId(key);
    try {
      const { url, isHls, durationSeconds } = await fetchUrl();
      setPlayer({ url, title, isHls, durationSeconds });
    } catch {
      // silently fail — NAS may have gone offline between status check and request
    } finally {
      setLoadingId(null);
    }
  };

  const handleDownload = async (fetchUrl: () => Promise<{ url: string }>, filename: string, key: string) => {
    setLoadingId(key);
    try {
      const { url } = await fetchUrl();
      const a = document.createElement('a');
      a.href = url;
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

  const directors = media.cast?.filter((c: any) => c.role === 'director') || [];
  const actors = media.cast?.filter((c: any) => c.role === 'actor') || [];
  const mediaTitle = media.titleVf || media.titleOriginal;

  return (
    <>
      {player && (
        <VideoPlayerModal
          url={player.url}
          title={player.title}
          isHls={player.isHls}
          durationSeconds={player.durationSeconds}
          onClose={() => setPlayer(null)}
        />
      )}

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
                {media.genres?.map((g: any) => (
                  <Badge key={g.genre?.id || g.genreId} variant="outline">{g.genre?.name || g.name}</Badge>
                ))}
              </div>

              {media.overview && <p className="text-zinc-300 text-sm leading-relaxed max-w-2xl mb-6">{media.overview}</p>}

              {directors.length > 0 && (
                <p className="text-sm mb-4">
                  <span className="text-zinc-500">Réalisateur : </span>
                  {directors.map((d: any) => d.person?.name || d.name).join(', ')}
                </p>
              )}

              {/* Stream / Download buttons — Movies only (series handled per-episode) */}
              {isMember && media.type === 'MOVIE' && media.nasPath && (
                <div className="flex items-center gap-3 mb-4 flex-wrap">
                  {/* NAS offline indicator */}
                  {!nasOnline && (
                    <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                      <WifiOff className="w-3.5 h-3.5" />
                      NAS hors ligne
                    </span>
                  )}

                  <button
                    disabled={!nasOnline || loadingId === `play-${id}`}
                    onClick={() => openPlayer(() => api.getStreamUrl(Number(id)), mediaTitle, `play-${id}`)}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#e50914] hover:bg-[#c4070f] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
                  >
                    {loadingId === `play-${id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-white stroke-none" />}
                    Regarder
                  </button>

                  <button
                    disabled={!nasOnline || loadingId === `dl-${id}`}
                    onClick={() => handleDownload(() => api.getStreamUrl(Number(id), 'download'), media.nasFilename || mediaTitle, `dl-${id}`)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm transition-colors border border-zinc-700"
                  >
                    {loadingId === `dl-${id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    Télécharger
                  </button>
                </div>
              )}

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
                {actors.map((a: any) => (
                  <div key={a.id} className="flex-shrink-0 w-28 text-center">
                    {a.person?.photoUrl ? (
                      <img src={a.person.photoUrl} alt={a.person.name} className="w-20 h-20 rounded-full mx-auto object-cover" />
                    ) : (
                      <div className="w-20 h-20 rounded-full bg-zinc-800 mx-auto" />
                    )}
                    <p className="text-xs mt-2 font-medium truncate">{a.person?.name}</p>
                    <p className="text-[10px] text-zinc-500 truncate">{a.character}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {media.seasons && media.seasons.length > 0 && (
            <section className="mt-10">
              <h2 className="text-xl font-bold mb-4">Saisons</h2>
              <div className="space-y-4">
                {media.seasons.map((season: any) => {
                  const nasEpisodes = season.episodes?.filter((ep: any) => ep.nasPath) || [];
                  return (
                    <div key={season.id} className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
                      <div className="flex items-center gap-4">
                        {season.posterUrl && <img src={season.posterUrl} alt={season.name} className="w-16 rounded flex-shrink-0" />}
                        <div className="flex-1">
                          <div className="flex items-center gap-3">
                            <h3 className="font-semibold">Saison {season.seasonNumber}</h3>
                            {nasEpisodes.length > 0 && (
                              <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-2 py-0.5 rounded">
                                <HardDrive className="w-3 h-3" />
                                {nasEpisodes.length} / {season.episodeCount || season.episodes?.length || '?'} sur NAS
                              </span>
                            )}
                          </div>
                          {season.name && <p className="text-sm text-zinc-400">{season.name}</p>}
                          {season.episodeCount && <p className="text-xs text-zinc-500">{season.episodeCount} épisodes</p>}
                        </div>
                      </div>
                      {season.episodes?.length > 0 && (
                        <div className="mt-3 space-y-1">
                          {season.episodes.map((ep: any) => {
                            const epKey = `ep-${ep.id}`;
                            const epTitle = `${mediaTitle} — S${String(season.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')} ${ep.name ? `— ${ep.name}` : ''}`;
                            return (
                              <div
                                key={ep.id}
                                className={`flex justify-between items-center text-sm py-2 px-2 rounded border-t border-zinc-800 ${ep.nasPath ? 'hover:bg-zinc-800/50' : ''}`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {ep.nasPath ? (
                                    <HardDrive className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" aria-label="Disponible sur le NAS" />
                                  ) : (
                                    <span className="w-3.5 h-3.5 flex-shrink-0" />
                                  )}
                                  <span className="text-zinc-500 flex-shrink-0">E{String(ep.episodeNumber).padStart(2, '0')}</span>
                                  <span className={`truncate ${ep.nasPath ? 'text-white' : 'text-zinc-400'}`}>
                                    {ep.name || `Épisode ${ep.episodeNumber}`}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                                  {ep.runtime && <span className="text-zinc-500 text-xs">{ep.runtime} min</span>}
                                  {ep.nasFilename && (
                                    <span className="text-[10px] text-zinc-600 truncate max-w-32 hidden lg:block" title={ep.nasFilename}>
                                      {ep.nasFilename}
                                    </span>
                                  )}
                                  {isMember && ep.nasPath && (
                                    <>
                                      <button
                                        disabled={!nasOnline || loadingId === `play-${epKey}`}
                                        onClick={() => openPlayer(() => api.getEpisodeStreamUrl(ep.id), epTitle, `play-${epKey}`)}
                                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#e50914] hover:bg-[#c4070f] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
                                        title={nasOnline ? 'Regarder' : 'NAS hors ligne'}
                                      >
                                        {loadingId === `play-${epKey}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3 fill-white stroke-none" />}
                                        Regarder
                                      </button>
                                      <button
                                        disabled={!nasOnline || loadingId === `dl-${epKey}`}
                                        onClick={() => handleDownload(() => api.getEpisodeStreamUrl(ep.id, 'download'), ep.nasFilename || epTitle, `dl-${epKey}`)}
                                        className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-400 hover:text-white transition-colors border border-zinc-700"
                                        title={nasOnline ? 'Télécharger' : 'NAS hors ligne'}
                                      >
                                        {loadingId === `dl-${epKey}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
