import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KEY, useRemoteKeys } from '../hooks/useRemoteKeys';
import { getNasStatus, wakeNas } from '../lib/api';

interface Props {
  focused: boolean;
  currentScreen?: string;
  cineClubName?: string;
  isAdmin?: boolean;
  onFocusDown: () => void;
  onNavigateHome: () => void;
  onNavigateFilms: () => void;
  onNavigateSeries: () => void;
  onNavigateSearch: () => void;
  onChangeCineClub: () => void;
  onLogout: () => void;
}

type NavItemId = 'home' | 'films' | 'series' | 'search' | 'wol' | 'cineclubs' | 'logout';

const BASE_ITEMS: NavItemId[] = ['home', 'films', 'series', 'search', 'wol', 'cineclubs', 'logout'];

/** Play-variant logo: rounded square with accent fill + play triangle */
function NasflixLogo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="40" height="40" rx="9" fill="var(--accent)" />
        <path d="M16 13 L28 20 L16 27 Z" fill="#0c0c10" />
      </svg>
      <span style={{
        fontFamily: 'Inter, sans-serif',
        fontWeight: 800,
        fontSize: '0.56rem',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
        lineHeight: 1,
      }}>
        nasflix
      </span>
    </div>
  );
}

function ClockDisplay() {
  const [time, setTime] = useState(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    };
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <span style={{ fontFamily: 'var(--mono)', fontSize: '0.38rem', color: 'var(--text-muted)' }}>
      {time}
    </span>
  );
}

export default function TVNavbar({
  focused,
  currentScreen,
  cineClubName,
  isAdmin,
  onFocusDown,
  onNavigateHome,
  onNavigateFilms,
  onNavigateSeries,
  onNavigateSearch,
  onChangeCineClub,
  onLogout,
}: Props) {
  const [focusedItem, setFocusedItem] = useState<NavItemId>('home');
  const [wolStatus, setWolStatus] = useState<'idle' | 'waking' | 'online'>('idle');

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
    if (item === 'home') onNavigateHome();
    else if (item === 'films') onNavigateFilms();
    else if (item === 'series') onNavigateSeries();
    else if (item === 'search') onNavigateSearch();
    else if (item === 'wol' && !nasOnline) handleWoL();
    else if (item === 'cineclubs') onChangeCineClub();
    else if (item === 'logout') onLogout();
  };

  // Hide wol when NAS is online
  const visibleItems = BASE_ITEMS.filter((id) => id !== 'wol' || !nasOnline) as NavItemId[];

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

  const navLinks: { id: NavItemId; label: string; icon?: React.ReactNode }[] = [
    { id: 'home', label: 'Accueil' },
    { id: 'films', label: 'Films' },
    { id: 'series', label: 'Séries' },
    {
      id: 'search',
      label: 'Rechercher',
      icon: (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
          <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.5 10.5 L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ),
    },
  ];

  return (
    <header style={{
      height: '84px',
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingLeft: '2rem',
      paddingRight: '2rem',
      background: 'linear-gradient(180deg, rgba(7,7,10,0.95) 0%, rgba(7,7,10,0.4) 80%, transparent)',
      position: 'relative',
      zIndex: 100,
    }}>
      {/* Left: Logo + separator + nav links */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
        {/* Logo */}
        <button
          onClick={() => { setFocusedItem('home'); onNavigateHome(); }}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '0',
            borderRadius: '4px',
            outline: focused && focusedItem === 'home' ? '2px solid var(--accent)' : 'none',
            outlineOffset: '5px',
            boxShadow: focused && focusedItem === 'home' ? '0 0 0 7px rgba(177,58,48,0.12)' : 'none',
          }}
        >
          <NasflixLogo />
        </button>

        {/* Separator */}
        <div style={{ width: 1, height: '24px', background: 'var(--line-strong)', flexShrink: 0 }} />

        {/* Nav tabs */}
        <nav style={{ display: 'flex', gap: '0.1rem' }}>
          {navLinks.map((item) => {
            const isActive = currentScreen === item.id;
            const isFocused = focused && focusedItem === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { setFocusedItem(item.id); activateItem(item.id); }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '0.25rem 0.6rem',
                  paddingBottom: isActive ? 'calc(0.25rem - 2px)' : '0.25rem',
                  borderRadius: '4px',
                  borderBottom: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
                  display: 'flex', alignItems: 'center', gap: '0.22rem',
                  fontSize: '0.47rem', fontWeight: isActive ? 600 : 500,
                  color: isActive ? '#fff' : 'var(--text-muted)',
                  outline: isFocused ? '2px solid var(--accent)' : 'none',
                  outlineOffset: '5px',
                  boxShadow: isFocused ? '0 0 0 7px rgba(177,58,48,0.12)' : 'none',
                  transition: 'color 0.12s, border-color 0.12s',
                }}
              >
                {item.icon}
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Right: NAS status + WoL + clock + cinéclub + avatar + logout */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
        {/* NAS status chip */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.3rem',
          padding: '3px 10px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid var(--line-strong)',
          borderRadius: '999px',
        }}>
          <span style={{
            width: '5px', height: '5px', borderRadius: '50%', flexShrink: 0,
            background: nasOnline ? 'var(--green-online)' : 'var(--red-offline)',
            boxShadow: nasOnline ? '0 0 5px var(--green-online)' : 'none',
            display: 'inline-block',
          }} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: '0.34rem', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
            NAS · DS920+
          </span>
        </div>

        {/* WoL (only if NAS offline and admin) */}
        {!nasOnline && isAdmin && (
          <button
            onClick={() => { setFocusedItem('wol'); handleWoL(); }}
            disabled={wolStatus !== 'idle'}
            data-focused={focused && focusedItem === 'wol'}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.3rem',
              padding: '3px 10px',
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent-line)',
              borderRadius: '999px', color: 'var(--text)',
              fontFamily: 'var(--mono)',
              fontSize: '0.34rem', fontWeight: 600, cursor: 'pointer',
              letterSpacing: '0.06em', textTransform: 'uppercase',
              outline: focused && focusedItem === 'wol' ? '2px solid var(--accent)' : 'none',
              outlineOffset: '5px',
            }}
          >
            {wolStatus === 'idle' ? '⚡ ALLUMER' : wolStatus === 'waking' ? 'DÉMARRAGE…' : 'EN LIGNE ✓'}
          </button>
        )}

        {/* Clock */}
        <ClockDisplay />

        {/* Separator */}
        <div style={{ width: 1, height: '24px', background: 'var(--line-strong)', flexShrink: 0 }} />

        {/* Cinéclub switcher */}
        {cineClubName && (
          <button
            onClick={() => { setFocusedItem('cineclubs'); onChangeCineClub(); }}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.3rem',
              padding: '3px 10px',
              background: focused && focusedItem === 'cineclubs' ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${focused && focusedItem === 'cineclubs' ? 'rgba(255,255,255,0.3)' : 'var(--line-strong)'}`,
              borderRadius: '999px', color: 'var(--text)',
              fontSize: '0.38rem', fontWeight: 600, cursor: 'pointer',
              outline: focused && focusedItem === 'cineclubs' ? '2px solid var(--accent)' : 'none',
              outlineOffset: '5px',
            }}
          >
            <span style={{ color: 'var(--text-dim)', fontSize: '0.34rem' }}>↕</span>
            {cineClubName}
          </button>
        )}

        {/* User avatar */}
        <div style={{
          width: '36px', height: '36px', borderRadius: '8px',
          background: 'linear-gradient(135deg, rgba(177,58,48,0.6), rgba(177,58,48,0.25))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--serif)',
          fontSize: '0.56rem', fontWeight: 400,
          color: 'var(--accent)',
          flexShrink: 0,
          border: '1px solid var(--accent-line)',
        }}>
          K
        </div>

        {/* Logout */}
        <button
          onClick={() => { setFocusedItem('logout'); onLogout(); }}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.3rem',
            padding: '3px 10px',
            background: focused && focusedItem === 'logout' ? 'rgba(177,58,48,0.2)' : 'transparent',
            border: `1px solid ${focused && focusedItem === 'logout' ? 'var(--accent-line)' : 'transparent'}`,
            borderRadius: '999px',
            color: focused && focusedItem === 'logout' ? '#fca5a5' : 'var(--text-dim)',
            fontSize: '0.38rem', fontWeight: 600, cursor: 'pointer',
            outline: 'none',
          }}
        >
          ⏻
        </button>
      </div>
    </header>
  );
}
