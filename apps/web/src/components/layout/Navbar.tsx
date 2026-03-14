import { Link, useLocation } from 'react-router';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

export function Navbar() {
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

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
          <Link
            to="/search"
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-all"
          >
            <Search className="w-5 h-5" />
          </Link>
          <Link
            to="/admin/login"
            className="text-xs text-zinc-500 hover:text-zinc-300 px-3 py-1.5 rounded-lg hover:bg-white/5 transition-all"
          >
            Paramétrage
          </Link>
        </div>
      </nav>
    </header>
  );
}
