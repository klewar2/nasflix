const ACCESS_KEY = 'tv_accessToken';
const REFRESH_KEY = 'tv_refreshToken';
const CINECLUB_KEY = 'tv_cineClub';
const SESSION_KEY = 'tv_sessionOnly';

function store(): Storage {
  return sessionStorage.getItem(SESSION_KEY) === '1' ? sessionStorage : localStorage;
}

export const tokens = {
  getAccess: () => store().getItem(ACCESS_KEY) ?? sessionStorage.getItem(ACCESS_KEY),
  getRefresh: () => store().getItem(REFRESH_KEY) ?? sessionStorage.getItem(REFRESH_KEY),
  set: (access: string, refresh: string, sessionOnly = false) => {
    if (sessionOnly) {
      sessionStorage.setItem(SESSION_KEY, '1');
      sessionStorage.setItem(ACCESS_KEY, access);
      sessionStorage.setItem(REFRESH_KEY, refresh);
    } else {
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.setItem(ACCESS_KEY, access);
      localStorage.setItem(REFRESH_KEY, refresh);
    }
  },
  clear: () => {
    [localStorage, sessionStorage].forEach((s) => {
      s.removeItem(ACCESS_KEY);
      s.removeItem(REFRESH_KEY);
      s.removeItem(CINECLUB_KEY);
      s.removeItem(SESSION_KEY);
    });
  },
  getCineClub: () => {
    const v = store().getItem(CINECLUB_KEY) ?? localStorage.getItem(CINECLUB_KEY);
    return v ? JSON.parse(v) : null;
  },
  setCineClub: (club: unknown) => store().setItem(CINECLUB_KEY, JSON.stringify(club)),
};
