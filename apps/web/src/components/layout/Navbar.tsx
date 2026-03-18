import { Link, useLocation } from 'react-router';
import { Search, Film, Tv2, Menu, X, Home, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export function Navbar() {
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Ferme le menu à chaque changement de page
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Bloque le scroll du body quand le menu est ouvert
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

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

  const navLinks = [
    { to: '/', label: 'Accueil', icon: Home },
    { to: '/films', label: 'Films', icon: Film, count: filmCount?.total },
    { to: '/series', label: 'Séries', icon: Tv2, count: seriesCount?.total },
  ];

  return (
    <>
      <header
        className={cn(
          'fixed top-0 left-0 right-0 z-50 transition-all duration-500',
          scrolled || menuOpen
            ? 'bg-zinc-950/95 backdrop-blur-xl border-b border-white/5 shadow-2xl shadow-black/40'
            : 'bg-gradient-to-b from-black/70 to-transparent',
        )}
      >
        <nav className="flex items-center justify-between px-4 md:px-8 py-4">
          {/* Logo + liens desktop */}
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center">
              <img src="/logo.svg" alt="Nasflix" className="hidden md:block h-7 w-auto" />
              <span
                className="md:hidden text-2xl font-black tracking-tighter select-none"
                style={{ color: '#e50914' }}
              >
                N
              </span>
            </Link>
            <div className="hidden md:flex items-center gap-1">
              {navLinks.map((link) => (
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

          {/* Droite desktop */}
          <div className="flex items-center gap-2">
            {/* Compteur médias — desktop seulement */}
            {(filmCount?.total !== undefined || seriesCount?.total !== undefined) && (
              <div className="hidden md:flex items-center gap-2 text-xs text-zinc-500 bg-zinc-900/80 border border-zinc-800/60 rounded-full px-3 py-1.5">
                <Film className="w-3 h-3 text-zinc-600" />
                <span className="tabular-nums">{filmCount?.total ?? '—'}</span>
                <span className="text-zinc-700">·</span>
                <Tv2 className="w-3 h-3 text-zinc-600" />
                <span className="tabular-nums">{seriesCount?.total ?? '—'}</span>
              </div>
            )}

            {/* Statut NAS — desktop seulement */}
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

            {/* Recherche — toujours visible */}
            <Link
              to="/search"
              className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-all"
            >
              <Search className="w-5 h-5" />
            </Link>

            {/* Paramétrage — desktop seulement */}
            <Link
              to="/admin"
              className="hidden md:inline-flex text-xs text-zinc-500 hover:text-zinc-300 px-3 py-1.5 rounded-lg hover:bg-white/5 transition-all"
            >
              Paramétrage
            </Link>

            {/* Burger — mobile seulement */}
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="md:hidden p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-all"
              aria-label={menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </nav>
      </header>

      {/* Overlay mobile */}
      <div
        className={cn(
          'fixed inset-0 z-40 md:hidden transition-all duration-300',
          menuOpen ? 'pointer-events-auto' : 'pointer-events-none',
        )}
      >
        {/* Fond flouté */}
        <div
          className={cn(
            'absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300',
            menuOpen ? 'opacity-100' : 'opacity-0',
          )}
          onClick={() => setMenuOpen(false)}
        />

        {/* Panneau */}
        <div
          className={cn(
            'absolute top-0 right-0 h-full w-72 bg-zinc-950 border-l border-white/5 shadow-2xl flex flex-col transition-transform duration-300 ease-in-out',
            menuOpen ? 'translate-x-0' : 'translate-x-full',
          )}
        >
          {/* En-tête du panneau */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
            <img src="/logo.svg" alt="Nasflix" className="h-6 w-auto" />
            <button
              onClick={() => setMenuOpen(false)}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/10 transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Corps du menu */}
          <div className="flex-1 overflow-y-auto py-2">

            {/* Section : Navigation */}
            <p className="px-5 pt-4 pb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
              Navigation
            </p>
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = location.pathname === link.to;
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={cn(
                    'flex items-center justify-between mx-2 px-3 py-3 rounded-xl transition-all',
                    isActive
                      ? 'bg-white/10 text-white'
                      : 'text-zinc-400 hover:text-white hover:bg-white/5',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Icon className={cn('w-4 h-4', isActive ? 'text-[#e50914]' : 'text-zinc-500')} />
                    <span className="text-sm font-medium">{link.label}</span>
                  </div>
                  {link.count !== undefined && (
                    <span className="text-xs tabular-nums text-zinc-600 bg-zinc-800/80 px-2 py-0.5 rounded-full">
                      {link.count}
                    </span>
                  )}
                </Link>
              );
            })}

            {/* Séparateur */}
            <div className="mx-5 my-3 h-px bg-white/5" />

            {/* Section : Recherche */}
            <p className="px-5 pb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
              Recherche
            </p>
            <Link
              to="/search"
              className={cn(
                'flex items-center gap-3 mx-2 px-3 py-3 rounded-xl transition-all',
                location.pathname === '/search'
                  ? 'bg-white/10 text-white'
                  : 'text-zinc-400 hover:text-white hover:bg-white/5',
              )}
            >
              <Search className={cn('w-4 h-4', location.pathname === '/search' ? 'text-[#e50914]' : 'text-zinc-500')} />
              <span className="text-sm font-medium">Rechercher</span>
            </Link>

            {/* Séparateur */}
            <div className="mx-5 my-3 h-px bg-white/5" />

            {/* Section : Administration */}
            <p className="px-5 pb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
              Administration
            </p>
            <Link
              to="/admin"
              className="flex items-center gap-3 mx-2 px-3 py-3 rounded-xl text-zinc-400 hover:text-white hover:bg-white/5 transition-all"
            >
              <Settings className="w-4 h-4 text-zinc-500" />
              <span className="text-sm font-medium">Paramétrage</span>
            </Link>
          </div>

          {/* Pied du panneau — statut NAS */}
          {nasStatus !== undefined && (
            <div className="px-5 py-4 border-t border-white/5">
              <div
                className={cn(
                  'flex items-center gap-2 text-xs rounded-xl px-3 py-2.5 border',
                  nasStatus.online
                    ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'
                    : 'text-red-400 bg-red-400/10 border-red-400/20',
                )}
              >
                <span
                  className={cn(
                    'w-2 h-2 rounded-full flex-shrink-0',
                    nasStatus.online ? 'bg-emerald-400 animate-pulse' : 'bg-red-400',
                  )}
                />
                <div className="flex flex-col">
                  <span className="font-semibold">
                    {nasStatus.online ? 'NAS en ligne' : 'NAS hors ligne'}
                  </span>
                  {!nasStatus.online && (
                    <span className="text-[10px] opacity-70 mt-0.5">
                      Dernier contact : {new Date(nasStatus.lastCheckedAt).toLocaleString('fr-FR')}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
