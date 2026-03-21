import { useQuery } from '@tanstack/react-query';
import VideoPlayer from '../components/VideoPlayer';
import { getStreamUrl, getEpisodeStreamUrl, getMediaTracks, getEpisodeTracks } from '../lib/api';

interface Props {
  mediaId: number;
  episodeId?: number;
  onBack: () => void;
}

export default function PlayerPage({ mediaId, episodeId, onBack }: Props) {
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
      tracks={tracks}
      onBack={onBack}
    />
  );
}
