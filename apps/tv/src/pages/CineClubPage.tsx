import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMyCineClubs, selectCineClub } from '../lib/api';
import { tokens } from '../lib/tokens';
import { KEY, useRemoteKeys } from '../hooks/useRemoteKeys';

interface Props {
  onSelect: () => void;
}

export default function CineClubPage({ onSelect }: Props) {
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [loading, setLoading] = useState(false);

  const { data: clubs = [] } = useQuery({
    queryKey: ['cineClubs'],
    queryFn: getMyCineClubs,
  });

  // Auto-sélection si un seul CineClub
  useEffect(() => {
    if (clubs.length === 1 && !loading) {
      handleSelect(clubs[0].id, clubs[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubs]);

  const handleSelect = async (id: number, club: unknown) => {
    setLoading(true);
    try {
      const res = await selectCineClub(id);
      tokens.set(res.accessToken, res.refreshToken);
      tokens.setCineClub(club);
      onSelect();
    } finally {
      setLoading(false);
    }
  };

  useRemoteKeys((e) => {
    if (e.keyCode === KEY.UP) {
      e.preventDefault();
      setFocusedIdx((i) => Math.max(0, i - 1));
    } else if (e.keyCode === KEY.DOWN) {
      e.preventDefault();
      setFocusedIdx((i) => Math.min(clubs.length - 1, i + 1));
    } else if (e.keyCode === KEY.OK) {
      e.preventDefault();
      if (clubs[focusedIdx]) handleSelect(clubs[focusedIdx].id, clubs[focusedIdx]);
    }
  }, [focusedIdx, clubs]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
      }}
    >
      <div style={{ width: '32rem' }}>
        <h1 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '2rem', textAlign: 'center' }}>
          Choisissez un CinéClub
        </h1>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {clubs.map((club, idx) => (
            <button
              key={club.id}
              data-focused={focusedIdx === idx}
              onFocus={() => setFocusedIdx(idx)}
              onClick={() => handleSelect(club.id, club)}
              disabled={loading}
              style={{
                padding: '1rem 1.5rem',
                background: focusedIdx === idx ? '#27272a' : 'var(--bg-card)',
                border: `2px solid ${focusedIdx === idx ? 'var(--red)' : 'transparent'}`,
                borderRadius: 'var(--radius)',
                color: 'var(--text)',
                fontSize: '0.95rem',
                fontWeight: 600,
                cursor: 'pointer',
                textAlign: 'left',
                transform: focusedIdx === idx ? 'scale(1.02)' : 'scale(1)',
                transition: 'all 0.15s ease',
              }}
            >
              {club.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
