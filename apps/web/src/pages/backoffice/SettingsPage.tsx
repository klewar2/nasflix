import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Save } from 'lucide-react';

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { cineClub, setCineClub } = useAuth();

  const isAdmin = cineClub?.role === 'ADMIN';

  // CineClub settings
  const [clubName, setClubName] = useState(cineClub?.name ?? '');
  const [nasUrl, setNasUrl] = useState(cineClub?.nasBaseUrl ?? '');
  const [nasFolders, setNasFolders] = useState(cineClub?.nasSharedFolders?.join(', ') ?? '');
  const [tmdbKey, setTmdbKey] = useState('');

  useEffect(() => {
    if (cineClub) {
      setClubName(cineClub.name);
      setNasUrl(cineClub.nasBaseUrl ?? '');
      setNasFolders(cineClub.nasSharedFolders?.join(', ') ?? '');
    }
  }, [cineClub]);

  const cineClubMutation = useMutation({
    mutationFn: () => {
      if (!cineClub) throw new Error('Aucun CineClub sélectionné');
      return api.updateCineClub(cineClub.id, {
        name: clubName || undefined,
        nasBaseUrl: nasUrl || undefined,
        nasSharedFolders: nasFolders.split(',').map((f) => f.trim()).filter(Boolean),
        ...(tmdbKey ? { tmdbApiKey: tmdbKey } : {}),
      });
    },
    onSuccess: (updated) => {
      setCineClub({ ...updated, role: cineClub?.role });
      setTmdbKey('');
      queryClient.invalidateQueries({ queryKey: ['cineclub'] });
    },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Paramètres</h1>
      {!cineClub && <p className="text-zinc-400">Aucun CineClub sélectionné.</p>}
      {cineClub && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>CineClub : {cineClub.name}</CardTitle>
                <Badge variant={isAdmin ? 'success' : 'secondary'}>{isAdmin ? 'Administrateur' : 'Spectateur'}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm text-zinc-400 mb-1 block">Nom du CineClub</label>
                <Input
                  placeholder="Mon CineClub"
                  value={clubName}
                  onChange={(e) => setClubName(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <label className="text-sm text-zinc-400 mb-1 block">URL du NAS</label>
                <Input
                  placeholder="https://mon-nas.synology.me:5001"
                  value={nasUrl}
                  onChange={(e) => setNasUrl(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <label className="text-sm text-zinc-400 mb-1 block">Dossiers à scanner (séparés par des virgules)</label>
                <Input
                  placeholder="/volume1/video/Films, /volume1/video/Series"
                  value={nasFolders}
                  onChange={(e) => setNasFolders(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <label className="text-sm text-zinc-400 mb-1 block">Clé TMDB API</label>
                <p className="text-xs text-zinc-500 mb-1">{cineClub.tmdbApiKey ? 'Clé configurée (masquée)' : 'Aucune clé — utilise la clé serveur par défaut'}</p>
                {isAdmin && (
                  <Input
                    placeholder="Nouvelle clé TMDB (optionnel)"
                    value={tmdbKey}
                    onChange={(e) => setTmdbKey(e.target.value)}
                  />
                )}
              </div>
              {isAdmin && (
                <>
                  <Button onClick={() => cineClubMutation.mutate()} disabled={cineClubMutation.isPending}>
                    <Save className="w-4 h-4 mr-2" />
                    {cineClubMutation.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
                  </Button>
                  {cineClubMutation.isSuccess && <p className="text-sm text-green-400">Configuration sauvegardée</p>}
                  {cineClubMutation.isError && (
                    <p className="text-sm text-destructive">
                      {cineClubMutation.error instanceof Error ? cineClubMutation.error.message : 'Erreur lors de la sauvegarde'}
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
