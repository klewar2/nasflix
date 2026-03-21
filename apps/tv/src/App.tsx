import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import SplashScreen from './components/SplashScreen';
import TVNavbar from './components/TVNavbar';
import DebugOverlay from './components/DebugOverlay';
import LoginPage from './pages/LoginPage';
import CineClubPage from './pages/CineClubPage';
import HomePage from './pages/HomePage';
import DetailPage from './pages/DetailPage';
import PlayerPage from './pages/PlayerPage';
import SearchPage from './pages/SearchPage';
import { tokens } from './lib/tokens';
import { getMe, getMyCineClubs } from './lib/api';

const DEBUG = import.meta.env.VITE_DEBUG === 'true' || window.location.search.includes('debug');

export type Screen =
  | { name: 'splash' }
  | { name: 'login' }
  | { name: 'cineclub' }
  | { name: 'home' }
  | { name: 'search' }
  | { name: 'detail'; mediaId: number; mediaType: 'movie' | 'series' }
  | { name: 'player'; mediaId: number; episodeId?: number; title?: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'splash' });
  const [prevScreen, setPrevScreen] = useState<Screen>({ name: 'home' });
  const [splashDone, setSplashDone] = useState(false);
  const [navFocused, setNavFocused] = useState(false);

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    enabled: splashDone && !!tokens.getAccess(),
    retry: false,
  });

  useQuery({
    queryKey: ['cineClubs'],
    queryFn: getMyCineClubs,
    enabled: !!me,
  });

  useEffect(() => {
    if (!splashDone) return;
    if (!tokens.getAccess()) {
      setScreen({ name: 'login' });
      return;
    }
    if (me) {
      const club = tokens.getCineClub();
      if (!club) setScreen({ name: 'cineclub' });
      else setScreen({ name: 'home' });
    }
  }, [splashDone, me]);

  const navigate = (s: Screen) => {
    setNavFocused(false);
    setPrevScreen(screen);
    setScreen(s);
  };

  const handleLogout = () => {
    tokens.clear();
    setNavFocused(false);
    setScreen({ name: 'login' });
  };

  const handleChangeCineClub = () => {
    setNavFocused(false);
    setScreen({ name: 'cineclub' });
  };

  if (screen.name === 'splash') {
    return <SplashScreen onDone={() => setSplashDone(true)} />;
  }

  if (screen.name === 'login') {
    return <LoginPage onLogin={() => setScreen({ name: 'cineclub' })} />;
  }

  if (screen.name === 'cineclub') {
    return <CineClubPage onSelect={() => setScreen({ name: 'home' })} />;
  }

  if (screen.name === 'player') {
    const backTarget = prevScreen.name === 'detail' ? prevScreen : { name: 'home' as const };
    return (
      <PlayerPage
        key={`${screen.mediaId}-${screen.episodeId}`}
        mediaId={screen.mediaId}
        episodeId={screen.episodeId}
        title={screen.title}
        onBack={() => { setPrevScreen({ name: 'home' }); setScreen(backTarget); }}
      />
    );
  }

  // Screens with navbar (home + search + detail)
  const cineClub = tokens.getCineClub() as { name?: string } | null;
  const isAdmin = me?.isSuperAdmin === true;
  const isNavScreen = screen.name === 'home' || screen.name === 'search' || screen.name === 'detail';

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {DEBUG && <DebugOverlay />}
      {isNavScreen && (
        <TVNavbar
          focused={navFocused}
          cineClubName={cineClub?.name}
          isAdmin={isAdmin}
          onFocusDown={() => setNavFocused(false)}
          onNavigateHome={() => { setNavFocused(false); setScreen({ name: 'home' }); }}
          onNavigateSearch={() => { setNavFocused(false); setScreen({ name: 'search' }); }}
          onChangeCineClub={handleChangeCineClub}
          onLogout={handleLogout}
        />
      )}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {/* HomePage stays mounted to preserve focus/scroll position */}
        <div style={{ display: screen.name === 'home' ? 'block' : 'none', height: '100%' }}>
          <HomePage
            navigate={navigate}
            me={me}
            active={screen.name === 'home'}
            navFocused={navFocused && screen.name === 'home'}
            onFocusNav={() => setNavFocused(true)}
          />
        </div>
        {screen.name === 'search' && (
          <SearchPage
            navigate={navigate}
            navFocused={navFocused}
            onFocusNav={() => setNavFocused(true)}
          />
        )}
        {screen.name === 'detail' && (
          <DetailPage
            key={screen.mediaId}
            mediaId={screen.mediaId}
            mediaType={screen.mediaType}
            navigate={navigate}
            navFocused={navFocused}
            onFocusNav={() => setNavFocused(true)}
          />
        )}
      </div>
    </div>
  );
}
