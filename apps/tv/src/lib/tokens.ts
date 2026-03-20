const ACCESS_KEY = 'tv_accessToken';
const REFRESH_KEY = 'tv_refreshToken';
const CINECLUB_KEY = 'tv_cineClub';

export const tokens = {
  getAccess: () => localStorage.getItem(ACCESS_KEY),
  getRefresh: () => localStorage.getItem(REFRESH_KEY),
  set: (access: string, refresh: string) => {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear: () => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(CINECLUB_KEY);
  },
  getCineClub: () => {
    const v = localStorage.getItem(CINECLUB_KEY);
    return v ? JSON.parse(v) : null;
  },
  setCineClub: (club: unknown) => localStorage.setItem(CINECLUB_KEY, JSON.stringify(club)),
};
