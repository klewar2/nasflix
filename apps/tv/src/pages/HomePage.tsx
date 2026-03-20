import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import MediaRow from '../components/MediaRow';
import { KEY, useRemoteKeys } from '../hooks/useRemoteKeys';
import { getRecentMedia, getMedia, getNasStatus, wakeNas } from '../lib/api';
import type { Screen } from '../App';

interface Props {
  navigate: (s: Screen) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  me: any;
}

type Row = { key: string; title: string };
const ROWS: Row[] = [
  { key: 'recent', title: 'Récemment ajoutés' },
  { key: 'movies', title: 'Films' },
  { key: 'series', title: 'Séries' },
];

// Nav zones: 0 = top bar (WoL button), 1..N = rows
type Zone = 'topbar' | number;

export default function HomePage({ navigate, me }: Props) {
  const [focusedZone, setFocusedZone] = useState<Zone>(1);
  const [wolStatus, setWolStatus] = useState<'idle' | 'waking' | 'online'>('idle');
  const isAdmin = me?.role === 'ADMIN' || me?.role === 'SUPER_ADMIN';

  const { data: recent = [] } = useQuery({
    queryKey: ['recent'],
    queryFn: () => getRecentMedia(20),
  });

  const { data: moviesResult } = useQuery({
    queryKey: ['media', 'movie'],
    queryFn: () => getMedia({ type: 'movie', limit: 30 }),
  });

  const { data: seriesResult } = useQuery({
    queryKey: ['media', 'series'],
    queryFn: () => getMedia({ type: 'series', limit: 30 }),
  });

  const { data: nasStatus } = useQuery({
    queryKey: ['nasStatus'],
    queryFn: getNasStatus,
    refetchInterval: 30_000,
  });

  const rowData = {
    recent: recent.map(normalizeMedia),
    movies: (moviesResult?.data || []).map(normalizeMedia),
    series: (seriesResult?.data || []).map(normalizeMedia),
  };

  const activeRows = ROWS.filter((r) => rowData[r.key as keyof typeof rowData].length > 0);
  const hasTopBar = isAdmin && !nasStatus?.online;
  const handleWoL = async () => {
    setWolStatus('waking');
    try {
      await wakeNas();
      // Wait for NAS to come online via polling since no socket here
      let attempts = 0;
      const check = setInterval(async () => {
        attempts++;
        try {
          const s = await getNasStatus();
          if (s.online) {
            clearInterval(check);
            setWolStatus('online');
          }
        } catch {
          // ignore
        }
        if (attempts > 30) {
          clearInterval(check);
          setWolStatus('idle');
        }
      }, 10_000);
    } catch {
      setWolStatus('idle');
    }
  };

  useRemoteKeys((e) => {
    if (e.keyCode === KEY.UP) {
      e.preventDefault();
      if (typeof focusedZone === 'number') {
        const newZone = focusedZone - 1;
        if (newZone < 0) return;
        if (newZone === 0 && hasTopBar) {
          setFocusedZone('topbar');
        } else {
          setFocusedZone(newZone);
        }
      }
    } else if (e.keyCode === KEY.DOWN) {
      e.preventDefault();
      if (focusedZone === 'topbar') {
        setFocusedZone(0);
      } else if (typeof focusedZone === 'number') {
        const newZone = focusedZone + 1;
        if (newZone < activeRows.length) setFocusedZone(newZone);
      }
    } else if (e.keyCode === KEY.OK && focusedZone === 'topbar') {
      e.preventDefault();
      if (wolStatus === 'idle') handleWoL();
    }
  }, [focusedZone, hasTopBar, activeRows.length, wolStatus]);

  // Default focus on first row when rows load
  useEffect(() => {
    if (activeRows.length > 0 && focusedZone === 1 && !hasTopBar) {
      setFocusedZone(0);
    }
  }, [activeRows.length]);

  return (
    <div style={{ width: '100%', height: '100%', overflowY: 'hidden', paddingTop: '2rem' }}>
      {/* Top bar: WoL button */}
      {hasTopBar && (
        <div style={{ display: 'flex', alignItems: 'center', paddingLeft: '3rem', marginBottom: '1.5rem' }}>
          <button
            data-focused={focusedZone === 'topbar'}
            onFocus={() => setFocusedZone('topbar')}
            onClick={() => wolStatus === 'idle' && handleWoL()}
            disabled={wolStatus !== 'idle'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1.2rem',
              background: focusedZone === 'topbar' ? 'var(--red)' : '#27272a',
              border: `2px solid ${focusedZone === 'topbar' ? 'var(--red)' : 'transparent'}`,
              borderRadius: '2rem',
              color: 'var(--text)',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
              transform: focusedZone === 'topbar' ? 'scale(1.04)' : 'scale(1)',
              transition: 'all 0.15s ease',
            }}
          >
            <span>⚡</span>
            {wolStatus === 'idle' && 'Allumer le NAS'}
            {wolStatus === 'waking' && 'Démarrage en cours…'}
            {wolStatus === 'online' && 'NAS en ligne ✓'}
          </button>
        </div>
      )}

      {/* Media rows */}
      {activeRows.map((row, idx) => (
        <MediaRow
          key={row.key}
          title={row.title}
          items={rowData[row.key as keyof typeof rowData]}
          rowFocused={focusedZone === idx}
          onSelect={(media) =>
            navigate({
              name: 'detail',
              mediaId: media.id,
              mediaType: media.type,
            })
          }
          onUp={() => {
            const newZone = idx - 1;
            if (newZone < 0 && hasTopBar) {
              setFocusedZone('topbar');
            } else if (newZone >= 0) {
              setFocusedZone(newZone);
            }
          }}
          onDown={() => {
            if (idx + 1 < activeRows.length) setFocusedZone(idx + 1);
          }}
        />
      ))}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeMedia(m: any) {
  return {
    id: m.id,
    title: m.title || m.originalTitle || 'Inconnu',
    posterPath: m.posterPath,
    releaseYear: m.releaseYear || (m.releaseDate ? new Date(m.releaseDate).getFullYear() : undefined),
    type: (m.type === 'series' ? 'series' : 'movie') as 'movie' | 'series',
  };
}
