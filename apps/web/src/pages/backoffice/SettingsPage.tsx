import { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Copy, RefreshCw, Save, Wifi } from 'lucide-react';

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { cineClub, setCineClub } = useAuth();

  const isAdmin = cineClub?.role === 'ADMIN';

  const [clubName, setClubName] = useState(cineClub?.name ?? '');
  const [nasUrl, setNasUrl] = useState(cineClub?.nasBaseUrl ?? '');
  const [nasFolders, setNasFolders] = useState(cineClub?.nasSharedFolders?.join(', ') ?? '');
  const [tmdbKey, setTmdbKey] = useState('');
  const [wolMac, setWolMac] = useState(cineClub?.nasWolMac ?? '');
  const [wolHost, setWolHost] = useState(cineClub?.nasWolHost ?? '');
  const [wolPort, setWolPort] = useState(String(cineClub?.nasWolPort ?? 9));
  const [freeboxUrl, setFreeboxUrl] = useState(cineClub?.freeboxApiUrl ?? '');
  const [freeboxStatus, setFreeboxStatus] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (cineClub) {
      setClubName(cineClub.name);
      setNasUrl(cineClub.nasBaseUrl ?? '');
      setNasFolders(cineClub.nasSharedFolders?.join(', ') ?? '');
      setWolMac(cineClub.nasWolMac ?? '');
      setWolHost(cineClub.nasWolHost ?? '');
      setWolPort(String(cineClub.nasWolPort ?? 9));
      setFreeboxUrl(cineClub.freeboxApiUrl ?? '');
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
        nasWolMac: wolMac || null,
        nasWolHost: wolHost || null,
        nasWolPort: wolPort ? parseInt(wolPort) : null,
      });
    },
    onSuccess: (updated) => {
      setCineClub({ ...updated, role: cineClub?.role });
      setTmdbKey('');
      queryClient.invalidateQueries({ queryKey: ['cineclub'] });
    },
  });

  const freeboxMutation = useMutation({
    mutationFn: () => api.startFreeboxRegistration(freeboxUrl),
    onSuccess: ({ trackId }) => {
      setFreeboxStatus('pending_validation');
      pollRef.current = setInterval(async () => {
        try {
          const { status } = await api.pollFreeboxRegistration(trackId);
          setFreeboxStatus(status);
          if (status !== 'pending_validation') {
            clearInterval(pollRef.current!);
            if (status === 'granted') queryClient.invalidateQueries({ queryKey: ['cineclub'] });
          }
        } catch {
          clearInterval(pollRef.current!);
          setFreeboxStatus('error');
        }
      }, 2000);
    },
  });

  const secretMutation = useMutation({
    mutationFn: () => {
      if (!cineClub) throw new Error('Aucun CineClub sélectionné');
      return api.generateWebhookSecret(cineClub.id);
    },
    onSuccess: ({ webhookSecret }) => {
      setGeneratedSecret(webhookSecret);
      setCopied(false);
      queryClient.invalidateQueries({ queryKey: ['cineclub'] });
    },
  });

  const handleCopySecret = () => {
    if (!generatedSecret) return;
    navigator.clipboard.writeText(generatedSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Paramètres</h1>
      {!cineClub && <p className="text-zinc-400">Aucun CineClub sélectionné.</p>}
      {cineClub && (
        <div className="space-y-6">
          {/* Paramètres généraux */}
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
                <Input placeholder="Mon CineClub" value={clubName} onChange={(e) => setClubName(e.target.value)} disabled={!isAdmin} />
              </div>
              <div>
                <label className="text-sm text-zinc-400 mb-1 block">URL du NAS</label>
                <Input placeholder="https://mon-nas.synology.me:5001" value={nasUrl} onChange={(e) => setNasUrl(e.target.value)} disabled={!isAdmin} />
              </div>
              <div>
                <label className="text-sm text-zinc-400 mb-1 block">Dossiers à scanner (séparés par des virgules)</label>
                <Input placeholder="/volume1/video/Films, /volume1/video/Series" value={nasFolders} onChange={(e) => setNasFolders(e.target.value)} disabled={!isAdmin} />
              </div>
              <div>
                <label className="text-sm text-zinc-400 mb-1 block">Clé TMDB API</label>
                <p className="text-xs text-zinc-500 mb-1">{cineClub.tmdbApiKey ? 'Clé configurée (masquée)' : 'Aucune clé — utilise la clé serveur par défaut'}</p>
                {isAdmin && <Input placeholder="Nouvelle clé TMDB (optionnel)" value={tmdbKey} onChange={(e) => setTmdbKey(e.target.value)} />}
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

          {/* Wake-on-LAN */}
          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle>Wake-on-LAN</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-zinc-500">Permet d'allumer le NAS depuis l'interface. Nécessite que WoL soit activé dans DSM et un port-forward UDP 9 sur le routeur.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-zinc-400 mb-1 block">Adresse MAC du NAS</label>
                    <Input placeholder="00:11:32:AA:BB:CC" value={wolMac} onChange={(e) => setWolMac(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm text-zinc-400 mb-1 block">Hôte WoL (IP publique ou DynDNS)</label>
                    <Input placeholder="klewar2.synology.me" value={wolHost} onChange={(e) => setWolHost(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm text-zinc-400 mb-1 block">Port UDP <span className="text-zinc-600">(défaut : 9)</span></label>
                    <Input type="number" placeholder="9" value={wolPort} onChange={(e) => setWolPort(e.target.value)} />
                  </div>
                </div>
                <Button onClick={() => cineClubMutation.mutate()} disabled={cineClubMutation.isPending} size="sm">
                  <Save className="w-4 h-4 mr-2" />
                  Sauvegarder WoL
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Freebox WoL */}
          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle>Wake-on-LAN via Freebox</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-zinc-500">
                  Méthode recommandée. La Freebox envoie elle-même le magic packet sur le LAN — fonctionne depuis internet sans port-forward UDP.
                  Nécessite d'activer la gestion à distance sur la Freebox OS et d'autoriser l'app (bouton physique).
                </p>
                <div className="flex items-center gap-2">
                  <Badge variant={cineClub.freeboxAppTokenSet ? 'success' : 'secondary'}>
                    {cineClub.freeboxAppTokenSet ? 'Connecté' : 'Non connecté'}
                  </Badge>
                </div>
                <div>
                  <label className="text-sm text-zinc-400 mb-1 block">URL API Freebox</label>
                  <Input
                    placeholder="https://mafreebox.fbxos.fr"
                    value={freeboxUrl}
                    onChange={(e) => setFreeboxUrl(e.target.value)}
                  />
                  <p className="text-xs text-zinc-600 mt-1">Trouvable dans Freebox OS → Paramètres → Gestion à distance</p>
                </div>
                <Button
                  size="sm"
                  onClick={() => { setFreeboxStatus(null); freeboxMutation.mutate(); }}
                  disabled={freeboxMutation.isPending || !freeboxUrl || freeboxStatus === 'pending_validation'}
                >
                  <Wifi className="w-4 h-4 mr-2" />
                  {cineClub.freeboxAppTokenSet ? 'Reconnecter' : 'Connecter la Freebox'}
                </Button>
                {freeboxStatus === 'pending_validation' && (
                  <p className="text-sm text-yellow-400">Appuyez sur le bouton de la Freebox pour autoriser...</p>
                )}
                {freeboxStatus === 'granted' && (
                  <p className="text-sm text-green-400">Freebox connectée avec succes !</p>
                )}
                {(freeboxStatus === 'denied' || freeboxStatus === 'timeout' || freeboxStatus === 'error') && (
                  <p className="text-sm text-destructive">
                    {freeboxStatus === 'denied' ? 'Autorisation refusée.' : freeboxStatus === 'timeout' ? 'Délai dépassé.' : 'Erreur de connexion.'}
                  </p>
                )}
                {freeboxMutation.isError && (
                  <p className="text-sm text-destructive">
                    {freeboxMutation.error instanceof Error ? freeboxMutation.error.message : 'Erreur'}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Secret webhook */}
          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle>Secret webhook NAS</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-zinc-500">
                  Identifie ce CineClub auprès de l'API sans header <code className="bg-zinc-800 px-1 rounded">x-cineclubid</code>. À renseigner dans <code className="bg-zinc-800 px-1 rounded">watch-downloads.sh</code> et <code className="bg-zinc-800 px-1 rounded">sync-on-boot.sh</code> comme valeur de <code className="bg-zinc-800 px-1 rounded">SECRET</code>.
                </p>
                <div className="flex items-center gap-2">
                  <Badge variant={cineClub.webhookSecretSet ? 'success' : 'secondary'}>
                    {cineClub.webhookSecretSet ? 'Secret configuré' : 'Aucun secret'}
                  </Badge>
                  <Button size="sm" variant="outline" onClick={() => secretMutation.mutate()} disabled={secretMutation.isPending}>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    {cineClub.webhookSecretSet ? 'Regénérer' : 'Générer un secret'}
                  </Button>
                </div>
                {generatedSecret && (
                  <div className="rounded-md bg-zinc-900 border border-zinc-700 p-3 space-y-2">
                    <p className="text-xs text-yellow-400">Copiez ce secret maintenant — il ne sera plus affiché.</p>
                    <div className="flex items-center gap-2">
                      <code className="text-xs text-zinc-200 font-mono break-all flex-1">{generatedSecret}</code>
                      <Button size="sm" variant="ghost" onClick={handleCopySecret}>
                        <Copy className="w-4 h-4" />
                        {copied ? 'Copié !' : ''}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
