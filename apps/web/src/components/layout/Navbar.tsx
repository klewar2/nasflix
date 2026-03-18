import { Link, useLocation } from 'react-router';
import { Search, Film, Tv2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export function Navbar() {
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const { data: filmCount } = useQuery({
    queryKey: ['count', 'films'],
    queryFn: () => api.getMedia({ type: 'MOVIE', limit: 1 }),
    staleTime: 5 * 60 * 1000,
  });

  const { data: seriesCount } = useQuery({
    queryKey: ['count', 'series'],
    queryFn: () => api.getMedia({ type: 'SERIES', limit: 1 }),
    staleTime: 5 * 60 * 1000,
  });

  const { data: nasStatus } = useQuery({
    queryKey: ['nas-status'],
    queryFn: () => api.getNasStatus(),
    refetchInterval: 30_000,
    retry: false,
  });

  const links = [
    { to: '/', label: 'Accueil' },
    { to: '/films', label: 'Films' },
    { to: '/series', label: 'Séries' },
  ];

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-500',
        scrolled
          ? 'bg-zinc-950/60 backdrop-blur-xl border-b border-white/5 shadow-2xl shadow-black/40'
          : 'bg-gradient-to-b from-black/70 to-transparent',
      )}
    >
      <nav className="flex items-center justify-between px-4 md:px-8 py-4">
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center">
            <img src="/logo.svg" alt="Nasflix" className="h-7 w-auto" />
          </Link>
          <div className="flex items-center gap-1">
            {links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={cn(
                  'text-sm px-3 py-1.5 rounded-lg transition-all',
                  location.pathname === link.to
                    ? 'text-white font-semibold bg-white/10 backdrop-blur-sm'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5',
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Media counts */}
          {(filmCount?.total !== undefined || seriesCount?.total !== undefined) && (
            <div className="hidden md:flex items-center gap-2 text-xs text-zinc-500 bg-zinc-900/80 border border-zinc-800/60 rounded-full px-3 py-1.5">
              <Film className="w-3 h-3 text-zinc-600" />
              <span className="tabular-nums">{filmCount?.total ?? '—'}</span>
              <span className="text-zinc-700">·</span>
              <Tv2 className="w-3 h-3 text-zinc-600" />
              <span className="tabular-nums">{seriesCount?.total ?? '—'}</span>
            </div>
          )}

          {/* NAS status */}
          {nasStatus !== undefined && (
            <div
              className={cn(
                'hidden sm:flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1 border',
                nasStatus.online
                  ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'
                  : 'text-red-400 bg-red-400/10 border-red-400/20',
              )}
              title={
                nasStatus.online
                  ? 'NAS en ligne'
                  : `NAS hors ligne — dernier contact : ${new Date(nasStatus.lastCheckedAt).toLocaleString('fr-FR')}`
              }
            >
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full flex-shrink-0',
                  nasStatus.online ? 'bg-emerald-400 animate-pulse' : 'bg-red-400',
                )}
              />
              <span className="hidden lg:inline font-medium">
                {nasStatus.online ? 'NAS en ligne' : 'NAS hors ligne'}
              </span>
            </div>
          )}

          <Link
            to="/search"
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-all"
          >
            <Search className="w-5 h-5" />
          </Link>
          <Link
            to="/admin"
            className="text-xs text-zinc-500 hover:text-zinc-300 px-3 py-1.5 rounded-lg hover:bg-white/5 transition-all"
          >
            Paramétrage
          </Link>
        </div>
      </nav>
    </header>
  );
}
