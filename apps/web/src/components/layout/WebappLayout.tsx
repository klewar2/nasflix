import { Outlet, Navigate } from 'react-router';
import { Navbar } from './Navbar';
import { useAuth } from '@/lib/auth';

export function WebappLayout() {
  const { isAuthenticated, hasCineClub, isLoading } = useAuth();

  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!hasCineClub) return <Navigate to="/cineclubs" replace />;

  return (
    <div className="min-h-screen bg-zinc-950">
      <Navbar />
      <main className="pt-16">
        <Outlet />
      </main>
      <footer className="text-center text-xs text-zinc-600 py-6 px-4">
        <p>Données fournies par <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-400">TMDB</a></p>
      </footer>
    </div>
  );
}
