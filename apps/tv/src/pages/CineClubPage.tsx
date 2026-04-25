import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMyCineClubs, getCineClubMembers, selectCineClub } from '../lib/api';
import { tokens } from '../lib/tokens';
import { KEY, useRemoteKeys } from '../hooks/useRemoteKeys';

interface Props {
  onSelect: () => void;
}

const AVATAR_COLORS = ['#b13a30', '#3a9690', '#c9954a', '#7a4ec9', '#3a6cb1'];

function ClubCard({ club, isFocused, accentColor, onClick, onFocus, loading }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  club: any; isFocused: boolean; accentColor: string;
  onClick: () => void; onFocus: () => void; loading: boolean;
}) {
  const { data: members = [] } = useQuery({
    queryKey: ['clubMembers', club.id],
    queryFn: () => getCineClubMembers(club.id),
    staleTime: 60_000,
  });
  const memberCount = members.length || (club.memberCount ?? club._count?.members ?? 0);
  const mediaCount = club.mediaCount ?? club._count?.media ?? 0;

  return (
    <button
      data-focused={isFocused}
      onFocus={onFocus}
      onClick={onClick}
      disabled={loading}
      style={{
        width: '15rem', padding: '1.125rem',
        background: isFocused
          ? `linear-gradient(160deg, rgba(177,58,48,0.16), rgba(20,20,28,0.95))`
          : 'rgba(20,20,28,0.6)',
        border: `1px solid ${isFocused ? 'var(--accent-line)' : 'var(--line-strong)'}`,
        borderRadius: '0.5rem', color: '#fff', cursor: 'pointer', textAlign: 'left',
        position: 'relative', overflow: 'hidden',
        outline: isFocused ? '3px solid rgba(255,255,255,0.5)' : 'none',
        outlineOffset: '3px',
        transform: isFocused ? 'translateY(-0.25rem)' : 'none',
        transition: 'all 0.15s ease',
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: accentColor }} />

      <div style={{ display: 'flex', marginBottom: '1rem', marginTop: '0.25rem' }}>
        {(members.length > 0 ? members.slice(0, 4) : Array.from({ length: Math.min(memberCount || 1, 4) })).map((m, i) => {
          const initial = members.length > 0
            ? ((m as { user: { firstName: string } }).user.firstName?.[0] ?? '?').toUpperCase()
            : '?';
          return (
            <div key={i} style={{
              width: '1.5rem', height: '1.5rem', borderRadius: '50%',
              background: AVATAR_COLORS[i % AVATAR_COLORS.length],
              marginLeft: i === 0 ? 0 : '-0.4375rem',
              border: '2px solid #14141c',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.5rem', fontWeight: 700, color: '#fff', flexShrink: 0,
            }}>
              {initial}
            </div>
          );
        })}
        {memberCount > 4 && (
          <div style={{
            width: '1.5rem', height: '1.5rem', borderRadius: '50%',
            background: 'rgba(255,255,255,0.12)', marginLeft: '-0.4375rem',
            border: '2px solid #14141c',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.34rem', color: 'var(--text-muted)', flexShrink: 0,
          }}>
            +{memberCount - 4}
          </div>
        )}
      </div>

      <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.3rem', color: '#fff' }}>
        {club.name}
      </div>
      <div style={{ fontSize: '0.41rem', color: 'var(--text-muted)', marginBottom: '0.625rem' }}>
        {memberCount > 0 ? `${memberCount} membre${memberCount !== 1 ? 's' : ''}` : 'Membres…'}
        {mediaCount > 0 && ` · ${mediaCount} titres`}
      </div>

      <div style={{
        position: 'absolute', bottom: '1rem', right: '1rem',
        fontSize: '0.875rem', color: isFocused ? 'rgba(255,255,255,0.6)' : 'var(--text-dim)',
        transition: 'color 0.15s',
      }}>›</div>
    </button>
  );
}

export default function CineClubPage({ onSelect }: Props) {
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);

  const { data: clubs = [] } = useQuery({
    queryKey: ['cineClubs'],
    queryFn: getMyCineClubs,
  });

  useEffect(() => { setTimeout(() => setVisible(true), 60); }, []);

  useEffect(() => {
    if (clubs.length === 1 && !loading) handleSelect(clubs[0].id, clubs[0]);
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
    if (e.keyCode === KEY.UP) { e.preventDefault(); setFocusedIdx((i) => Math.max(0, i - 1)); }
    else if (e.keyCode === KEY.DOWN) { e.preventDefault(); setFocusedIdx((i) => Math.min(clubs.length - 1, i + 1)); }
    else if (e.keyCode === KEY.LEFT) { e.preventDefault(); setFocusedIdx((i) => Math.max(0, i - 1)); }
    else if (e.keyCode === KEY.RIGHT) { e.preventDefault(); setFocusedIdx((i) => Math.min(clubs.length - 1, i + 1)); }
    else if (e.keyCode === KEY.OK) { e.preventDefault(); if (clubs[focusedIdx]) handleSelect(clubs[focusedIdx].id, clubs[focusedIdx]); }
  }, [focusedIdx, clubs]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accentColors = ['#b13a30', '#3a9690', '#c9954a', '#7a4ec9', '#3a6cb1'];

  return (
    <div style={{
      position: 'relative', width: '100%', height: '100%',
      background: 'linear-gradient(135deg, #0a0a0e 0%, #14141c 100%)',
      overflow: 'hidden',
    }}>
      {/* Background glow */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse at 70% 0%, rgba(201,59,59,0.08), transparent 60%)',
      }} />

      <div style={{
        position: 'relative', height: '100%', padding: '2rem 3rem',
        display: 'flex', flexDirection: 'column',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(0.8rem)',
        transition: 'opacity 0.4s ease, transform 0.4s ease',
      }}>
        {/* Top bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.75rem' }}>
          <NasflixLogo size={32} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.44rem', color: 'var(--text-muted)' }}>Connecté en tant que</span>
            <div style={{
              width: '1.125rem', height: '1.125rem', borderRadius: '50%',
              background: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.44rem', fontWeight: 700, color: '#fff',
            }}>
              N
            </div>
          </div>
        </div>

        {/* Heading */}
        <div style={{ marginBottom: '2rem' }}>
          <div className="uppercase-eyebrow" style={{ letterSpacing: '0.28em', marginBottom: '0.4rem' }}>
            Choisissez un cinéclub
          </div>
          <h1 style={{
            fontFamily: 'var(--serif)',
            fontSize: '2.625rem', fontWeight: 400,
            lineHeight: 1.0, marginBottom: '0.5rem',
            color: '#fff', letterSpacing: '-0.02em',
          }}>
            Vos cinéclubs
          </h1>
          <p style={{ fontSize: '0.53rem', color: 'var(--text-muted)', maxWidth: '22.5rem', lineHeight: 1.5 }}>
            Chaque cinéclub a son propre catalogue. Vous pouvez en changer à tout moment depuis la barre du haut.
          </p>
        </div>

        {/* Cards */}
        {clubs.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: '0.55rem' }}>
            Chargement…
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {clubs.map((club, idx) => (
              <ClubCard
                key={club.id}
                club={club}
                isFocused={focusedIdx === idx}
                accentColor={accentColors[idx % accentColors.length]}
                onClick={() => handleSelect(club.id, club)}
                onFocus={() => setFocusedIdx(idx)}
                loading={loading}
              />
            ))}

            {/* "Join a club" card */}
            <div style={{
              width: '15rem', padding: '1.125rem',
              background: 'transparent',
              border: '1px dashed rgba(255,255,255,0.15)',
              borderRadius: '0.5rem',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: '0.5rem', color: 'var(--text-dim)',
              minHeight: '10rem',
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.4 }}>
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                <path d="M12 7v10M7 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span style={{ fontSize: '0.44rem' }}>Rejoindre un club</span>
            </div>
          </div>
        )}

        {/* Hint */}
        <div style={{ marginTop: 'auto', paddingTop: '1.25rem' }}>
          <p style={{ fontSize: '0.41rem', color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>
            ← → naviguer · OK sélectionner
          </p>
        </div>
      </div>
    </div>
  );
}

function NasflixLogo({ size }: { size: number }) {
  const s = size / 32;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: `${s * 0.4}rem` }}>
      <svg width={size * 1.1} height={size * 1.1} viewBox="0 0 40 40" fill="none">
        <rect width="40" height="40" rx="9" fill="var(--accent)" />
        <path d="M16 13 L28 20 L16 27 Z" fill="#0c0c10" />
      </svg>
      <span style={{
        fontFamily: 'Inter, sans-serif', fontWeight: 800,
        fontSize: `${s * 0.82}rem`, letterSpacing: '0.02em',
        textTransform: 'uppercase', color: 'var(--text)',
      }}>
        nasflix
      </span>
    </div>
  );
}
