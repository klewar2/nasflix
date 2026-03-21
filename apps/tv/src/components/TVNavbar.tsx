import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KEY, useRemoteKeys } from '../hooks/useRemoteKeys';
import { getMedia, getNasStatus, wakeNas } from '../lib/api';

interface Props {
  focused: boolean;
  cineClubName?: string;
  isAdmin?: boolean;
  onFocusDown: () => void;
  onNavigateHome: () => void;
  onNavigateSearch: () => void;
  onChangeCineClub: () => void;
  onLogout: () => void;
}

// Nav items order (for LEFT/RIGHT navigation)
type NavItemId = 'logo' | 'wol' | 'search' | 'cineclubs' | 'logout';
const NAV_ITEMS: NavItemId[] = ['logo', 'wol', 'search', 'cineclubs', 'logout'];

export default function TVNavbar({
  focused,
  cineClubName,
  isAdmin,
  onFocusDown,
  onNavigateHome,
  onNavigateSearch,
  onChangeCineClub,
  onLogout,
}: Props) {
  const [focusedItem, setFocusedItem] = useState<NavItemId>('logo');
  const [wolStatus, setWolStatus] = useState<'idle' | 'waking' | 'online'>('idle');

  const { data: moviesResult } = useQuery({
    queryKey: ['count', 'movie'],
    queryFn: () => getMedia({ type: 'movie', limit: 1 }),
    staleTime: 5 * 60 * 1000,
  });
  const { data: seriesResult } = useQuery({
    queryKey: ['count', 'series'],
    queryFn: () => getMedia({ type: 'series', limit: 1 }),
    staleTime: 5 * 60 * 1000,
  });
  const { data: nasStatus } = useQuery({
    queryKey: ['nasStatus'],
    queryFn: getNasStatus,
    refetchInterval: 30_000,
  });

  const nasOnline = nasStatus?.online ?? true;

  const handleWoL = async () => {
    if (wolStatus !== 'idle') return;
    setWolStatus('waking');
    try {
      await wakeNas();
      let attempts = 0;
      const check = setInterval(async () => {
        attempts++;
        try {
          const s = await getNasStatus();
          if (s.online) { clearInterval(check); setWolStatus('online'); }
        } catch { /* ignore */ }
        if (attempts > 30) { clearInterval(check); setWolStatus('idle'); }
      }, 10_000);
    } catch {
      setWolStatus('idle');
    }
  };

  const activateItem = (item: NavItemId) => {
    if (item === 'logo') onNavigateHome();
    else if (item === 'wol' && !nasOnline) handleWoL();
    else if (item === 'search') onNavigateSearch();
    else if (item === 'cineclubs') onChangeCineClub();
    else if (item === 'logout') onLogout();
  };

  // Compute visible nav items (hide wol if NAS online)
  const visibleItems = NAV_ITEMS.filter(id => id !== 'wol' || !nasOnline) as NavItemId[];

  useRemoteKeys((e) => {
    if (!focused) return;
    e.preventDefault();
    if (e.keyCode === KEY.DOWN) {
      onFocusDown();
    } else if (e.keyCode === KEY.LEFT) {
      const idx = visibleItems.indexOf(focusedItem);
      if (idx > 0) setFocusedItem(visibleItems[idx - 1]);
    } else if (e.keyCode === KEY.RIGHT) {
      const idx = visibleItems.indexOf(focusedItem);
      if (idx < visibleItems.length - 1) setFocusedItem(visibleItems[idx + 1]);
    } else if (e.keyCode === KEY.OK) {
      activateItem(focusedItem);
    } else if (e.keyCode === KEY.BACK) {
      onFocusDown();
    }
  }, [focused, focusedItem, visibleItems, nasOnline, wolStatus]);

  const filmCount = moviesResult?.total;
  const seriesCount = seriesResult?.total;

  return (
    <header style={{
      height: '64px',
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingLeft: '2.5rem',
      paddingRight: '2.5rem',
      background: 'rgba(9,9,11,0.97)',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      position: 'relative',
      zIndex: 100,
    }}>
      {/* Left: Logo + NAS status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
        {/* Logo */}
        <button
          onClick={() => { setFocusedItem('logo'); activateItem('logo'); }}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '0.3rem 0.5rem',
            borderRadius: '6px',
            outline: focused && focusedItem === 'logo' ? '2px solid var(--red)' : 'none',
          }}
        >
          <span style={{
            fontSize: '1.6rem',
            fontWeight: 900,
            letterSpacing: '-0.04em',
            color: 'var(--red)',
            lineHeight: 1,
          }}>
            N<span style={{ color: '#fff', fontSize: '1rem', letterSpacing: '0.02em' }}>ASFLIX</span>
          </span>
        </button>

        {/* NAS status dot */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{
            width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
            background: nasOnline ? '#22c55e' : '#ef4444',
            boxShadow: nasOnline ? '0 0 6px #22c55e' : 'none',
            display: 'inline-block',
          }} />
          <span style={{ fontSize: '0.55rem', color: 'rgba(255,255,255,0.35)', fontWeight: 500 }}>
            {nasOnline ? 'NAS en ligne' : 'NAS hors ligne'}
          </span>
        </div>

        {/* WoL button (only if NAS offline and admin) */}
        {!nasOnline && isAdmin && (
          <button
            onClick={() => { setFocusedItem('wol'); handleWoL(); }}
            disabled={wolStatus !== 'idle'}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.3rem 0.8rem',
              background: focused && focusedItem === 'wol' ? 'var(--red)' : 'rgba(229,9,20,0.15)',
              border: `1px solid ${focused && focusedItem === 'wol' ? 'var(--red)' : 'rgba(229,9,20,0.3)'}`,
              borderRadius: '2rem', color: '#fff',
              fontSize: '0.5rem', fontWeight: 700, cursor: 'pointer',
            }}
          >
            ⚡ {wolStatus === 'idle' ? 'Allumer' : wolStatus === 'waking' ? 'Démarrage…' : 'En ligne ✓'}
          </button>
        )}
      </div>

      {/* Center: search button */}
      <button
        onClick={() => { setFocusedItem('search'); activateItem('search'); }}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.45rem',
          padding: '0.35rem 1rem',
          background: focused && focusedItem === 'search' ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)',
          border: `1px solid ${focused && focusedItem === 'search' ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.1)'}`,
          borderRadius: '2rem', color: '#fff',
          fontSize: '0.55rem', fontWeight: 600, cursor: 'pointer',
          outline: focused && focusedItem === 'search' ? '2px solid rgba(255,255,255,0.45)' : 'none',
        }}
      >
        🔍 <span style={{ color: 'rgba(255,255,255,0.6)' }}>Rechercher…</span>
      </button>

      {/* Right: counts + cinéclub + logout */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.2rem' }}>
        {/* Compteurs */}
        {(filmCount !== undefined || seriesCount !== undefined) && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.3rem 0.75rem',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '2rem',
            fontSize: '0.5rem', color: 'rgba(255,255,255,0.45)',
          }}>
            <span>🎬</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: '#fff', fontWeight: 600 }}>{filmCount ?? '—'}</span>
            <span style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
            <span>📺</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: '#fff', fontWeight: 600 }}>{seriesCount ?? '—'}</span>
          </div>
        )}

        {/* Cinéclub switcher */}
        {cineClubName && (
          <button
            onClick={() => { setFocusedItem('cineclubs'); onChangeCineClub(); }}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.3rem 0.75rem',
              background: focused && focusedItem === 'cineclubs' ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${focused && focusedItem === 'cineclubs' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: '2rem', color: '#fff',
              fontSize: '0.5rem', fontWeight: 600, cursor: 'pointer',
              outline: focused && focusedItem === 'cineclubs' ? '2px solid rgba(255,255,255,0.4)' : 'none',
            }}
          >
            <span style={{ color: 'rgba(255,255,255,0.5)' }}>↕</span>
            {cineClubName}
          </button>
        )}

        {/* Logout */}
        <button
          onClick={() => { setFocusedItem('logout'); onLogout(); }}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            padding: '0.3rem 0.75rem',
            background: focused && focusedItem === 'logout' ? 'rgba(229,9,20,0.2)' : 'transparent',
            border: `1px solid ${focused && focusedItem === 'logout' ? 'rgba(229,9,20,0.5)' : 'transparent'}`,
            borderRadius: '2rem', color: focused && focusedItem === 'logout' ? '#ef4444' : 'rgba(255,255,255,0.35)',
            fontSize: '0.5rem', fontWeight: 600, cursor: 'pointer',
            outline: 'none',
          }}
        >
          ⏻ Déconnexion
        </button>
      </div>

      {/* Focus indicator bar at bottom */}
      {focused && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: '2px',
          background: 'linear-gradient(90deg, transparent, var(--red), transparent)',
        }} />
      )}
    </header>
  );
}
