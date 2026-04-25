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
import ListPage from './pages/ListPage';
import { tokens } from './lib/tokens';
import { getMe, getMyCineClubs } from './lib/api';

const DEBUG = import.meta.env.VITE_DEBUG === 'true' || window.location.search.includes('debug');

export type Screen =
  | { name: 'splash' }
  | { name: 'login' }
  | { name: 'cineclub' }
  | { name: 'home' }
  | { name: 'films' }
  | { name: 'series' }
  | { name: 'search' }
  | { name: 'detail'; mediaId: number; mediaType: 'movie' | 'series' }
  | { name: 'player'; mediaId: number; episodeId?: number; title?: string; nextEpisodeId?: number; nextEpisodeTitle?: string; videoQuality?: string; hdr?: boolean };

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
        nextEpisodeId={screen.nextEpisodeId}
        nextEpisodeTitle={screen.nextEpisodeTitle}
        videoQuality={screen.videoQuality}
        hdr={screen.hdr}
        onBack={() => { setPrevScreen({ name: 'home' }); setScreen(backTarget); }}
        onNextEpisode={screen.nextEpisodeId !== undefined ? () => {
          navigate({
            name: 'player',
            mediaId: screen.mediaId,
            episodeId: screen.nextEpisodeId,
            title: screen.nextEpisodeTitle,
          });
        } : undefined}
      />
    );
  }

  // Screens with navbar
  const cineClub = tokens.getCineClub() as { name?: string } | null;
  const isAdmin = me?.isSuperAdmin === true;
  const isNavScreen =
    screen.name === 'home' ||
    screen.name === 'films' ||
    screen.name === 'series' ||
    screen.name === 'search' ||
    screen.name === 'detail';

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {DEBUG && <DebugOverlay />}
      {isNavScreen && (
        <TVNavbar
          focused={navFocused}
          currentScreen={screen.name}
          cineClubName={cineClub?.name}
          isAdmin={isAdmin}
          onFocusDown={() => setNavFocused(false)}
          onNavigateHome={() => { setNavFocused(false); setScreen({ name: 'home' }); }}
          onNavigateFilms={() => { setNavFocused(false); setScreen({ name: 'films' }); }}
          onNavigateSeries={() => { setNavFocused(false); setScreen({ name: 'series' }); }}
          onNavigateSearch={() => { setNavFocused(false); setScreen({ name: 'search' }); }}
          onChangeCineClub={handleChangeCineClub}
          onLogout={handleLogout}
        />
      )}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {/* HomePage stays mounted to preserve focus/scroll */}
        <div style={{ display: screen.name === 'home' ? 'block' : 'none', height: '100%' }}>
          <HomePage
            navigate={navigate}
            me={me}
            active={screen.name === 'home'}
            navFocused={navFocused && screen.name === 'home'}
            onFocusNav={() => setNavFocused(true)}
          />
        </div>

        {screen.name === 'films' && (
          <ListPage
            kind="movies"
            navigate={navigate}
            navFocused={navFocused}
            onFocusNav={() => setNavFocused(true)}
          />
        )}

        {screen.name === 'series' && (
          <ListPage
            kind="series"
            navigate={navigate}
            navFocused={navFocused}
            onFocusNav={() => setNavFocused(true)}
          />
        )}

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
