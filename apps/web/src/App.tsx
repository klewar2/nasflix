import { useState, useCallback, useMemo, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { AuthContext } from '@/lib/auth';
import { api } from '@/lib/api-client';
import type { UserResponse, CineClubResponse } from '@nasflix/shared';

export default function App() {
  const [user, setUserState] = useState<UserResponse | null>(null);
  const [isLoading, setIsLoading] = useState(api.isAuthenticated());
  const [cineClub, setCineClubState] = useState<CineClubResponse | null>(() => {
    const stored = localStorage.getItem('currentCineClub');
    return stored ? (JSON.parse(stored) as CineClubResponse) : null;
  });
  const navigate = useNavigate();

  useEffect(() => {
    if (api.isAuthenticated() && !user) {
      api.getMe()
        .then(setUserState)
        .catch(() => {
          api.clearTokens();
          navigate('/login', { replace: true });
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setUser = useCallback((u: UserResponse) => {
    setUserState(u);
  }, []);

  const logout = useCallback(() => {
    api.clearTokens();
    setUserState(null);
    setCineClubState(null);
    navigate('/login', { replace: true });
  }, [navigate]);

  const setCineClub = useCallback((club: CineClubResponse) => {
    setCineClubState(club);
    localStorage.setItem('currentCineClub', JSON.stringify(club));
  }, []);

  const contextValue = useMemo(
    () => ({
      user,
      cineClub,
      isAuthenticated: !!user && api.isAuthenticated(),
      hasCineClub: !!cineClub,
      isLoading,
      setUser,
      logout,
      setCineClub,
    }),
    [user, cineClub, isLoading, setUser, logout, setCineClub],
  );

  return (
    <AuthContext.Provider value={contextValue}>
      <Outlet />
    </AuthContext.Provider>
  );
}
