import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Film, LogOut } from 'lucide-react';
import type { CineClubResponse } from '@nasflix/shared';

export default function CineClubSelectorPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading, logout, setCineClub } = useAuth();
  const [clubs, setClubs] = useState<CineClubResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      navigate('/login', { replace: true });
      return;
    }
    api.getMyCineClubs()
      .then(async (fetched) => {
        setClubs(fetched);
        // Auto-select when the user has exactly one CineClub
        if (fetched.length === 1) {
          await handleSelect(fetched[0]);
        }
      })
      .catch(() => setError('Impossible de charger les CineClubs'))
      .finally(() => setLoading(false));
  // handleSelect is defined below — disable the exhaustive-deps warning intentionally
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, isLoading, navigate]);

  const handleSelect = async (club: CineClubResponse) => {
    setSelecting(club.id);
    try {
      const tokens = await api.selectCineClub(club.id);
      api.setTokens(tokens);
      setCineClub(club);
      navigate('/');
    } catch (err: unknown) {
      console.error(err.message);
      setError(err instanceof Error ? err.message : 'Erreur lors de la sélection');
    } finally {
      setSelecting(null);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-4 gap-8">
      <div className="text-center">
        <Film className="w-12 h-12 text-primary mx-auto mb-3" />
        <h1 className="text-3xl font-bold text-white">Nasflix</h1>
        <p className="text-zinc-400 mt-2">Sélectionnez votre CineClub</p>
      </div>

      {loading && <p className="text-zinc-400">Chargement...</p>}
      {error && <p className="text-destructive">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full max-w-2xl">
        {clubs.map((club) => (
          <Card
            key={club.id}
            className="cursor-pointer hover:border-primary transition-colors"
            onClick={() => handleSelect(club)}
          >
            <CardContent className="p-6 flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center">
                <Film className="w-7 h-7 text-primary" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-white">{club.name}</p>
                {club.role && (
                  <p className="text-xs text-zinc-400 mt-1">{club.role === 'ADMIN' ? 'Administrateur' : 'Spectateur'}</p>
                )}
              </div>
              {selecting === club.id && <p className="text-xs text-zinc-400">Connexion...</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Button variant="ghost" size="sm" onClick={logout} className="text-zinc-400">
        <LogOut className="w-4 h-4 mr-2" />
        Se déconnecter
      </Button>
    </div>
  );
}
