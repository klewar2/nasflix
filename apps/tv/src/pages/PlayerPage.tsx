import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import VideoPlayer from '../components/VideoPlayer';
import { getStreamUrl, getEpisodeStreamUrl, getMediaTracks, getEpisodeTracks, getNasSubtitles, getNasEpisodeSubtitles, getMediaById } from '../lib/api';
import type { Screen } from '../App';

interface Props {
  mediaId: number;
  episodeId?: number;
  title?: string;
  seriesTitle?: string;
  videoQuality?: string;
  hdr?: boolean;
  onBack: () => void;
  navigate: (s: Screen) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isEpAvailable(ep: any): boolean {
  return (!!ep.nasPath && !ep.nasDeletedAt) || !!ep.jellyfinItemId;
}

export default function PlayerPage({ mediaId, episodeId, title, seriesTitle, videoQuality, hdr, onBack, navigate }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['stream', mediaId, episodeId],
    queryFn: () =>
      episodeId ? getEpisodeStreamUrl(episodeId) : getStreamUrl(mediaId),
    staleTime: Infinity,
  });

  // Lancé en parallèle — ne bloque pas la lecture
  const { data: tracks } = useQuery({
    queryKey: ['tracks', mediaId, episodeId],
    queryFn: () => episodeId ? getEpisodeTracks(episodeId) : getMediaTracks(mediaId),
    staleTime: Infinity,
  });

  // NAS subtitle cache — extraction FFmpeg backend, résultat mis en cache en DB
  const { data: nasSubtitleCache } = useQuery({
    queryKey: ['nas-subtitles', mediaId, episodeId],
    queryFn: () => episodeId ? getNasEpisodeSubtitles(episodeId) : getNasSubtitles(mediaId),
    enabled: data?.sourceType === 'NAS',
    staleTime: Infinity,
  });

  // Pour les séries : précharger le média pour pouvoir calculer prev/next à la volée.
  // Le cache est partagé avec DetailPage (même queryKey).
  const { data: media } = useQuery({
    queryKey: ['media', mediaId],
    queryFn: () => getMediaById(mediaId),
    enabled: !!episodeId,
    staleTime: 60_000,
  });

  const neighbors = useMemo(() => {
    if (!episodeId || !media?.seasons) return { prev: null, next: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const flat: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sortedSeasons = [...(media.seasons || [])].sort((a: any, b: any) => a.seasonNumber - b.seasonNumber);
    for (const s of sortedSeasons) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const eps = [...(s.episodes || [])]
        .filter(isEpAvailable)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .sort((a: any, b: any) => a.episodeNumber - b.episodeNumber);
      for (const e of eps) flat.push({ ...e, seasonNumber: s.seasonNumber });
    }
    const idx = flat.findIndex((e) => e.id === episodeId);
    if (idx < 0) return { prev: null, next: null };
    return { prev: flat[idx - 1] ?? null, next: flat[idx + 1] ?? null };
  }, [episodeId, media]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buildEpisodeTitle = (ep: any): string => {
    const base = seriesTitle || media?.titleVf || media?.titleOriginal || '';
    return `${base} · S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}`;
  };

  const onNextEpisode = neighbors.next ? () => {
    const ep = neighbors.next;
    navigate({
      name: 'player',
      mediaId,
      episodeId: ep.id,
      title: buildEpisodeTitle(ep),
      seriesTitle: seriesTitle || media?.titleVf || media?.titleOriginal,
      videoQuality, hdr,
    });
  } : undefined;

  const onPrevEpisode = neighbors.prev ? () => {
    const ep = neighbors.prev;
    navigate({
      name: 'player',
      mediaId,
      episodeId: ep.id,
      title: buildEpisodeTitle(ep),
      seriesTitle: seriesTitle || media?.titleVf || media?.titleOriginal,
      videoQuality, hdr,
    });
  } : undefined;

  if (isLoading) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: '#000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        <div
          style={{
            width: '3rem',
            height: '3rem',
            border: '4px solid #333',
            borderTop: '4px solid var(--red)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }}
        />
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Chargement du flux…</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: '#000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        <span style={{ color: 'var(--red)', fontSize: '1rem' }}>Erreur de lecture</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          Le NAS est peut-être hors ligne
        </span>
        <button
          onClick={onBack}
          style={{
            marginTop: '1rem',
            padding: '0.6rem 1.5rem',
            background: 'var(--red)',
            border: 'none',
            borderRadius: 'var(--radius)',
            color: '#fff',
            fontSize: '0.85rem',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          ← Retour
        </button>
      </div>
    );
  }

  return (
    <VideoPlayer
      url={data.url}
      isHls={data.isHls}
      durationSeconds={data.durationSeconds}
      title={title}
      tracks={tracks}
      mediaId={mediaId}
      episodeId={episodeId}
      sourceType={data.sourceType as 'NAS' | 'SEEDBOX' | undefined}
      jellyfinItemId={data.jellyfinItemId}
      jellyfinBaseUrl={data.jellyfinBaseUrl}
      jellyfinApiToken={data.jellyfinApiToken}
      nasSubtitleCache={nasSubtitleCache}
      videoQuality={videoQuality}
      hdr={hdr}
      onBack={onBack}
      onNextEpisode={onNextEpisode}
      onPrevEpisode={onPrevEpisode}
    />
  );
}
