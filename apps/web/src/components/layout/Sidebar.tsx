import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import { LayoutDashboard, Film, RefreshCw, Settings, LogOut, Users, UserCircle, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

const navItems = [
  { to: '/admin/dashboard', icon: LayoutDashboard, label: 'Dashboard', adminOnly: false },
  { to: '/admin/media', icon: Film, label: 'Médias', adminOnly: false },
  { to: '/admin/sync', icon: RefreshCw, label: 'Synchronisation', adminOnly: true },
  { to: '/admin/settings', icon: Settings, label: 'Paramètres', adminOnly: true },
  { to: '/admin/users', icon: Users, label: 'Utilisateurs', adminOnly: true },
  { to: '/admin/profile', icon: UserCircle, label: 'Mon profil', adminOnly: false },
];

function JellyfinStatusBadge() {
  const { cineClub } = useAuth();
  const { data } = useQuery({
    queryKey: ['jellyfin-status'],
    queryFn: () => api.getJellyfinStatus(),
    enabled: !!cineClub?.jellyfinApiTokenSet,
    refetchInterval: 60_000,
    staleTime: 50_000,
  });
  if (!cineClub?.jellyfinApiTokenSet) return null;
  return (
    <div className="px-3 py-1.5 flex items-center gap-2 text-xs text-zinc-500">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${data?.online ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
      <span className="truncate">Jellyfin {data?.online ? 'en ligne' : 'hors ligne'}</span>
    </div>
  );
}

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  const { logout, cineClub } = useAuth();
  const isAdmin = cineClub?.role === 'ADMIN';

  return (
    <>
      <nav className="flex-1 p-3 space-y-1">
        {navItems.filter(item => !item.adminOnly || isAdmin).map((item) => (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
              location.pathname.startsWith(item.to)
                ? 'bg-white/[0.08] text-white'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.05]',
            )}
          >
            <item.icon className="w-4 h-4" />
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="p-3 border-t border-white/[0.06]">
        <JellyfinStatusBadge />
        <Link
          to="/"
          onClick={onNavigate}
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-zinc-400 hover:text-white hover:bg-white/[0.05] mb-1"
        >
          <Film className="w-4 h-4" />
          Voir le site
        </Link>
        <button
          onClick={() => { logout(); onNavigate?.(); }}
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-zinc-400 hover:text-white hover:bg-white/[0.05] w-full"
        >
          <LogOut className="w-4 h-4" />
          Déconnexion
        </button>
      </div>
    </>
  );
}

export function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Ferme le menu sur changement de route
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed left-0 top-0 bottom-0 w-60 bg-zinc-900/70 backdrop-blur-2xl border-r border-white/[0.06] flex-col z-10">
        <div className="p-4 border-b border-white/[0.06]">
          <Link to="/admin/dashboard" className="text-primary font-bold text-lg">Nasflix</Link>
          <p className="text-xs text-zinc-500 mt-1">Backoffice</p>
        </div>
        <NavContent />
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-20 h-14 bg-zinc-900/90 backdrop-blur-xl border-b border-white/[0.06] flex items-center justify-between px-4">
        <Link to="/admin/dashboard" className="text-primary font-bold text-lg">Nasflix</Link>
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 text-zinc-400 hover:text-white"
          aria-label="Ouvrir le menu"
        >
          <Menu className="w-5 h-5" />
        </button>
      </header>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-30 flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          {/* Drawer */}
          <aside className="relative w-72 max-w-[85vw] bg-zinc-900 border-r border-white/[0.06] flex flex-col h-full">
            <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
              <div>
                <p className="text-primary font-bold text-lg">Nasflix</p>
                <p className="text-xs text-zinc-500">Backoffice</p>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-2 text-zinc-400 hover:text-white"
                aria-label="Fermer le menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <NavContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
