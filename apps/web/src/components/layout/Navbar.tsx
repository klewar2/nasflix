import { Link, useLocation } from 'react-router';
import { Search } from 'lucide-react';
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
          <Link to="/" className="flex items-center">
            <img src="/logo.svg" alt="Nasflix" className="h-7 w-auto" />
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
        <div className="flex items-center gap-4">
          <Link to="/search" className="text-zinc-400 hover:text-white transition-colors">
            <Search className="w-5 h-5" />
          </Link>
          <Link to="/admin/login" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
            Paramétrage
          </Link>
        </div>
      </nav>
    </header>
  );
}
