import { Link, useLocation } from 'react-router';
import { Search, Film } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Navbar() {
  const location = useLocation();

  const links = [
    { to: '/', label: 'Accueil' },
    { to: '/films', label: 'Films' },
    { to: '/series', label: 'Séries' },
  ];

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-b from-black/80 to-transparent">
      <nav className="flex items-center justify-between px-4 md:px-8 py-4">
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2 text-primary font-bold text-xl">
            <Film className="w-6 h-6" />
            <span className="hidden sm:inline">Nasflix</span>
          </Link>
          <div className="flex items-center gap-4">
            {links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={cn(
                  'text-sm transition-colors hover:text-white',
                  location.pathname === link.to ? 'text-white font-semibold' : 'text-zinc-400',
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
        <Link to="/search" className="text-zinc-400 hover:text-white transition-colors">
          <Search className="w-5 h-5" />
        </Link>
      </nav>
    </header>
  );
}
