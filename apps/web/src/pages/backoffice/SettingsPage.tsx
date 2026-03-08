import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Save } from 'lucide-react';

export default function SettingsPage() {
  const queryClient = useQueryClient();

  const { data: nasConfig } = useQuery({ queryKey: ['nas', 'config'], queryFn: () => api.getNasConfig() });
  const { data: nasStatus } = useQuery({ queryKey: ['nas', 'status'], queryFn: () => api.getNasStatus(), refetchInterval: 30000 });

  const [nasUrl, setNasUrl] = useState('');
  const [nasUsername, setNasUsername] = useState('');
  const [nasPassword, setNasPassword] = useState('');
  const [nasFolders, setNasFolders] = useState('');

  useEffect(() => {
    if (nasConfig) {
      setNasUrl(nasConfig.baseUrl || '');
      setNasUsername(nasConfig.username || '');
      setNasFolders(nasConfig.sharedFolders?.join(', ') || '');
    }
  }, [nasConfig]);

  const nasConfigMutation = useMutation({
    mutationFn: () => api.updateNasConfig({
      baseUrl: nasUrl,
      username: nasUsername,
      ...(nasPassword ? { password: nasPassword } : {}),
      sharedFolders: nasFolders.split(',').map((f) => f.trim()).filter(Boolean),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nas'] }),
  });

  const { data: apiConfigs } = useQuery({ queryKey: ['api', 'configs'], queryFn: () => api.getApiConfigs() });
  const [tmdbKey, setTmdbKey] = useState('');

  const apiConfigMutation = useMutation({
    mutationFn: () => api.updateApiConfig({ provider: 'tmdb', apiKey: tmdbKey }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['api', 'configs'] }); setTmdbKey(''); },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Paramètres</h1>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Configuration NAS</CardTitle>
              <Badge variant={nasStatus?.online ? 'success' : 'destructive'}>{nasStatus?.online ? 'En ligne' : 'Hors ligne'}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm text-zinc-400 mb-1 block">URL du NAS</label>
              <Input placeholder="https://mon-nas.synology.me:5001" value={nasUrl} onChange={(e) => setNasUrl(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-zinc-400 mb-1 block">Nom d'utilisateur</label>
              <Input value={nasUsername} onChange={(e) => setNasUsername(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-zinc-400 mb-1 block">Mot de passe</label>
              <Input type="password" placeholder="Laisser vide pour ne pas changer" value={nasPassword} onChange={(e) => setNasPassword(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-zinc-400 mb-1 block">Dossiers à scanner (séparés par des virgules)</label>
              <Input placeholder="/volume1/video/Films, /volume1/video/Series" value={nasFolders} onChange={(e) => setNasFolders(e.target.value)} />
            </div>
            <Button onClick={() => nasConfigMutation.mutate()} disabled={nasConfigMutation.isPending}>
              <Save className="w-4 h-4 mr-2" />{nasConfigMutation.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
            </Button>
            {nasConfigMutation.isSuccess && <p className="text-sm text-green-400">Configuration sauvegardée</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Clés API</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm text-zinc-400 mb-1 block">TMDB API Key</label>
              {apiConfigs?.map((c: any) => <p key={c.id} className="text-xs text-zinc-500 mb-2">Actuelle : {c.apiKey}</p>)}
              <Input placeholder="Nouvelle clé API TMDB" value={tmdbKey} onChange={(e) => setTmdbKey(e.target.value)} />
            </div>
            <Button onClick={() => apiConfigMutation.mutate()} disabled={!tmdbKey || apiConfigMutation.isPending}>
              <Save className="w-4 h-4 mr-2" />Mettre à jour
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
