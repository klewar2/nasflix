import { Link, useLocation } from 'react-router';
import { LayoutDashboard, Film, RefreshCw, Settings, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';

const navItems = [
  { to: '/admin/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/admin/media', icon: Film, label: 'Médias' },
  { to: '/admin/sync', icon: RefreshCw, label: 'Synchronisation' },
  { to: '/admin/settings', icon: Settings, label: 'Paramètres' },
];

export function Sidebar() {
  const location = useLocation();
  const { logout } = useAuth();

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-60 bg-zinc-900/70 backdrop-blur-2xl border-r border-white/[0.06] flex flex-col z-10">
      <div className="p-4 border-b border-white/[0.06]">
        <Link to="/admin/dashboard" className="text-primary font-bold text-lg">Nasflix</Link>
        <p className="text-xs text-zinc-500 mt-1">Backoffice</p>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => (
          <Link
            key={item.to}
            to={item.to}
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
        <Link to="/" className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-zinc-400 hover:text-white hover:bg-white/[0.05] mb-1">
          <Film className="w-4 h-4" />
          Voir le site
        </Link>
        <button onClick={logout} className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-zinc-400 hover:text-white hover:bg-white/[0.05] w-full">
          <LogOut className="w-4 h-4" />
          Déconnexion
        </button>
      </div>
    </aside>
  );
}
