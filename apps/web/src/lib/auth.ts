import { createContext, useContext } from 'react';
import type { UserResponse, CineClubResponse } from '@nasflix/shared';

export interface AuthState {
  user: UserResponse | null;
  cineClub: CineClubResponse | null;
  isAuthenticated: boolean;
  hasCineClub: boolean;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  setUser: (user: UserResponse) => void;
  logout: () => void;
  setCineClub: (club: CineClubResponse) => void;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  cineClub: null,
  isAuthenticated: false,
  hasCineClub: false,
  isLoading: true,
  setUser: () => {},
  logout: () => {},
  setCineClub: () => {},
});

export const useAuth = () => useContext(AuthContext);
