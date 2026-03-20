import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import SplashScreen from './components/SplashScreen';
import LoginPage from './pages/LoginPage';
import CineClubPage from './pages/CineClubPage';
import HomePage from './pages/HomePage';
import DetailPage from './pages/DetailPage';
import PlayerPage from './pages/PlayerPage';
import { tokens } from './lib/tokens';
import { getMe, getMyCineClubs } from './lib/api';

export type Screen =
  | { name: 'splash' }
  | { name: 'login' }
  | { name: 'cineclub' }
  | { name: 'home' }
  | { name: 'detail'; mediaId: number; mediaType: 'movie' | 'series' }
  | { name: 'player'; mediaId: number; episodeId?: number };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'splash' });
  const [splashDone, setSplashDone] = useState(false);

  const { data: me, isError: meError } = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    enabled: splashDone,
    retry: false,
  });

  const { data: cineClubs } = useQuery({
    queryKey: ['cineClubs'],
    queryFn: getMyCineClubs,
    enabled: !!me,
  });

  useEffect(() => {
    if (!splashDone) return;

    if (meError || !tokens.getAccess()) {
      setScreen({ name: 'login' });
      return;
    }

    if (me) {
      const club = tokens.getCineClub();
      if (!club) {
        setScreen({ name: 'cineclub' });
      } else {
        setScreen({ name: 'home' });
      }
    }
  }, [splashDone, me, meError, cineClubs]);

  const navigate = (s: Screen) => setScreen(s);

  if (screen.name === 'splash') {
    return <SplashScreen onDone={() => setSplashDone(true)} />;
  }

  if (screen.name === 'login') {
    return <LoginPage onLogin={() => setScreen({ name: 'cineclub' })} />;
  }

  if (screen.name === 'cineclub') {
    return <CineClubPage onSelect={() => setScreen({ name: 'home' })} />;
  }

  if (screen.name === 'home') {
    return <HomePage navigate={navigate} me={me} />;
  }

  if (screen.name === 'detail') {
    return (
      <DetailPage
        mediaId={screen.mediaId}
        mediaType={screen.mediaType}
        navigate={navigate}
      />
    );
  }

  if (screen.name === 'player') {
    return (
      <PlayerPage
        mediaId={screen.mediaId}
        episodeId={screen.episodeId}
        onBack={() => setScreen({ name: 'home' })}
      />
    );
  }

  return null;
}
