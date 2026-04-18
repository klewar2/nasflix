import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Copy, RefreshCw, Save, Wifi } from 'lucide-react';

// ── Formulaire paramètres généraux ────────────────────────────────────────────
function GeneralSettingsCard() {
  const queryClient = useQueryClient();
  const { cineClub, setCineClub } = useAuth();
  const isAdmin = cineClub?.role === 'ADMIN';

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

  const mutation = useMutation({
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
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>CineClub : {cineClub?.name}</CardTitle>
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
          <p className="text-xs text-zinc-500 mb-1">{cineClub?.tmdbApiKey ? 'Clé configurée (masquée)' : 'Aucune clé — utilise la clé serveur par défaut'}</p>
          {isAdmin && <Input placeholder="Nouvelle clé TMDB (optionnel)" value={tmdbKey} onChange={(e) => setTmdbKey(e.target.value)} />}
        </div>
        {isAdmin && (
          <>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              <Save className="w-4 h-4 mr-2" />
              {mutation.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
            </Button>
            {mutation.isSuccess && <p className="text-sm text-green-400">Configuration sauvegardée</p>}
            {mutation.isError && (
              <p className="text-sm text-destructive">
                {mutation.error instanceof Error ? mutation.error.message : 'Erreur lors de la sauvegarde'}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Formulaire Wake-on-LAN ─────────────────────────────────────────────────────
function WolCard() {
  const queryClient = useQueryClient();
  const { cineClub, setCineClub } = useAuth();

  const [wolMac, setWolMac] = useState(cineClub?.nasWolMac ?? '');
  const [wolHost, setWolHost] = useState(cineClub?.nasWolHost ?? '');
  const [wolPort, setWolPort] = useState(String(cineClub?.nasWolPort ?? 9));

  useEffect(() => {
    if (cineClub) {
      setWolMac(cineClub.nasWolMac ?? '');
      setWolHost(cineClub.nasWolHost ?? '');
      setWolPort(String(cineClub.nasWolPort ?? 9));
    }
  }, [cineClub]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!cineClub) throw new Error('Aucun CineClub sélectionné');
      return api.updateCineClub(cineClub.id, {
        nasWolMac: wolMac || null,
        nasWolHost: wolHost || null,
        nasWolPort: wolPort ? parseInt(wolPort) : null,
      });
    },
    onSuccess: (updated) => {
      setCineClub({ ...updated, role: cineClub?.role });
      queryClient.invalidateQueries({ queryKey: ['cineclub'] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Wake-on-LAN</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-zinc-500">Adresse MAC requise. Le WoL passe par la Freebox si un token est configuré, sinon par UDP direct (nécessite port-forward).</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-zinc-400 mb-1 block">Adresse MAC du NAS</label>
            <Input placeholder="00:11:32:AA:BB:CC" value={wolMac} onChange={(e) => setWolMac(e.target.value)} />
          </div>
          <div>
            <label className="text-sm text-zinc-400 mb-1 block">Hôte WoL fallback <span className="text-zinc-600">(UDP direct)</span></label>
            <Input placeholder="klewar2.synology.me" value={wolHost} onChange={(e) => setWolHost(e.target.value)} />
          </div>
          <div>
            <label className="text-sm text-zinc-400 mb-1 block">Port UDP <span className="text-zinc-600">(défaut : 9)</span></label>
            <Input type="number" placeholder="9" value={wolPort} onChange={(e) => setWolPort(e.target.value)} />
          </div>
        </div>
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} size="sm">
          <Save className="w-4 h-4 mr-2" />
          {mutation.isPending ? 'Sauvegarde...' : 'Sauvegarder WoL'}
        </Button>
        {mutation.isSuccess && <p className="text-sm text-green-400">Configuration WoL sauvegardée</p>}
        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof Error ? mutation.error.message : 'Erreur'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Formulaire Freebox ─────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="ml-2 text-zinc-400 hover:text-zinc-200 transition-colors shrink-0"
      title="Copier"
    >
      <Copy className="w-3.5 h-3.5 inline" />
      {copied && <span className="ml-1 text-xs text-green-400">Copié</span>}
    </button>
  );
}

function FreeboxCard() {
  const queryClient = useQueryClient();
  const { cineClub } = useAuth();
  const [freeboxUrl, setFreeboxUrl] = useState(cineClub?.freeboxApiUrl ?? '');
  const [appToken, setAppToken] = useState('');

  useEffect(() => {
    if (cineClub) setFreeboxUrl(cineClub.freeboxApiUrl ?? '');
  }, [cineClub]);

  const cmd1 = `curl -s -X POST http://mafreebox.freebox.fr/api/v8/login/authorize/ \\\n  -H "Content-Type: application/json" \\\n  -d '{"app_id":"nasflix","app_name":"Nasflix","app_version":"1.0.0","device_name":"Nasflix Web"}' \\\n  | jq -r '.result | "app_token: \\(.app_token)\\ntrack_id: \\(.track_id)"'`;
  const cmd1copy = `curl -s -X POST http://mafreebox.freebox.fr/api/v8/login/authorize/ -H "Content-Type: application/json" -d '{"app_id":"nasflix","app_name":"Nasflix","app_version":"1.0.0","device_name":"Nasflix Web"}' | jq -r '.result | "app_token: \\(.app_token)\\ntrack_id: \\(.track_id)"'`;
  const trackIdPlaceholder = '<track_id>';
  const cmd2 = `curl -s http://mafreebox.freebox.fr/api/v8/login/authorize/${trackIdPlaceholder} | jq '.result.status'`;

  const mutation = useMutation({
    mutationFn: () => api.saveFreeboxToken(freeboxUrl, appToken),
    onSuccess: () => {
      setAppToken('');
      queryClient.invalidateQueries({ queryKey: ['cineclub'] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Freebox API</CardTitle>
          <Badge variant={cineClub?.freeboxAppTokenSet ? 'success' : 'secondary'}>
            {cineClub?.freeboxAppTokenSet ? 'Token configuré' : 'Non configuré'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-xs text-zinc-500">
          Permet au WoL de passer par la Freebox depuis internet. La configuration se fait une seule fois via des commandes curl sur ton réseau local.
        </p>

        <div>
          <label className="text-sm text-zinc-400 mb-1 block">URL externe Freebox <span className="text-zinc-600">(utilisée par le serveur pour le WoL)</span></label>
          <Input
            placeholder="https://xxxxxxxx.fbxos.fr:16958"
            value={freeboxUrl}
            onChange={(e) => setFreeboxUrl(e.target.value)}
          />
          <p className="text-xs text-zinc-600 mt-1">
            Champs <code className="bg-zinc-800 px-1 rounded">api_domain</code> + <code className="bg-zinc-800 px-1 rounded">https_port</code> depuis{' '}
            <code className="bg-zinc-800 px-1 rounded">curl http://mafreebox.freebox.fr/api_version</code>
          </p>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium text-zinc-300">Depuis ton réseau local (une seule fois) :</p>

          <div>
            <p className="text-xs text-zinc-400 mb-1">1. Lance cette commande et note le <code className="bg-zinc-800 px-1 rounded">app_token</code> et le <code className="bg-zinc-800 px-1 rounded">track_id</code> :</p>
            <div className="relative rounded bg-zinc-900 border border-zinc-700 p-3 pr-8">
              <pre className="text-xs text-zinc-300 whitespace-pre-wrap break-all font-mono">{cmd1}</pre>
              <span className="absolute top-2 right-2"><CopyButton text={cmd1copy} /></span>
            </div>
          </div>

          <div>
            <p className="text-xs text-zinc-400 mb-1">2. Appuie sur <strong className="text-zinc-200">OK</strong> sur l'écran LCD de ta Freebox.</p>
          </div>

          <div>
            <p className="text-xs text-zinc-400 mb-1">3. Vérifie que le statut est <code className="bg-zinc-800 px-1 rounded">granted</code> :</p>
            <div className="relative rounded bg-zinc-900 border border-zinc-700 p-3 pr-8">
              <pre className="text-xs text-zinc-300 font-mono">{cmd2}</pre>
              <span className="absolute top-2 right-2"><CopyButton text={cmd2} /></span>
            </div>
          </div>

          <div>
            <p className="text-xs text-zinc-400 mb-1">4. Colle l'<code className="bg-zinc-800 px-1 rounded">app_token</code> obtenu à l'étape 1 :</p>
            <Input
              type="password"
              placeholder={cineClub?.freeboxAppTokenSet ? '••••••••••••••••' : 'app_token'}
              value={appToken}
              onChange={(e) => setAppToken(e.target.value)}
            />
          </div>
        </div>

        <Button
          size="sm"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !freeboxUrl || !appToken}
        >
          <Save className="w-4 h-4 mr-2" />
          {mutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
        </Button>
        {mutation.isSuccess && <p className="text-sm text-green-400">Token Freebox enregistré.</p>}
        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof Error ? mutation.error.message : 'Erreur'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Formulaire webhook secret ──────────────────────────────────────────────────
function WebhookSecretCard() {
  const queryClient = useQueryClient();
  const { cineClub } = useAuth();
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const mutation = useMutation({
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

  const handleCopy = () => {
    if (!generatedSecret) return;
    navigator.clipboard.writeText(generatedSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Secret webhook NAS</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-zinc-500">
          Identifie ce CineClub auprès de l'API sans header <code className="bg-zinc-800 px-1 rounded">x-cineclubid</code>. À renseigner dans{' '}
          <code className="bg-zinc-800 px-1 rounded">watch-downloads.sh</code> et{' '}
          <code className="bg-zinc-800 px-1 rounded">sync-on-boot.sh</code> comme valeur de <code className="bg-zinc-800 px-1 rounded">SECRET</code>.
        </p>
        <div className="flex items-center gap-2">
          <Badge variant={cineClub?.webhookSecretSet ? 'success' : 'secondary'}>
            {cineClub?.webhookSecretSet ? 'Secret configuré' : 'Aucun secret'}
          </Badge>
          <Button size="sm" variant="outline" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            <RefreshCw className="w-4 h-4 mr-2" />
            {cineClub?.webhookSecretSet ? 'Regénérer' : 'Générer un secret'}
          </Button>
        </div>
        {generatedSecret && (
          <div className="rounded-md bg-zinc-900 border border-zinc-700 p-3 space-y-2">
            <p className="text-xs text-yellow-400">Copiez ce secret maintenant — il ne sera plus affiché.</p>
            <div className="flex items-center gap-2">
              <code className="text-xs text-zinc-200 font-mono break-all flex-1">{generatedSecret}</code>
              <Button size="sm" variant="ghost" onClick={handleCopy}>
                <Copy className="w-4 h-4" />
                {copied ? 'Copié !' : ''}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Section Seedbox / Jellyfin ─────────────────────────────────────────────────
function JellyfinCard() {
  const { cineClub } = useAuth();
  const [jellyfinUrl, setJellyfinUrl] = useState(cineClub?.jellyfinBaseUrl ?? '');
  const [jellyfinToken, setJellyfinToken] = useState('');
  const [syncResult, setSyncResult] = useState<string | null>(null);

  useEffect(() => {
    if (cineClub) setJellyfinUrl(cineClub.jellyfinBaseUrl ?? '');
  }, [cineClub]);

  const saveMutation = useMutation({
    mutationFn: () => api.saveJellyfinConfig(jellyfinUrl, jellyfinToken),
    onSuccess: () => { setJellyfinToken(''); },
  });

  const { data: status, refetch: refetchStatus, isFetching: isCheckingStatus } = useQuery({
    queryKey: ['jellyfin-status'],
    queryFn: () => api.getJellyfinStatus(),
    enabled: false,
  });

  const syncMutation = useMutation({
    mutationFn: () => api.syncFromJellyfin(),
    onSuccess: (data) => {
      setSyncResult(`${data.message} — ${data.processed} traités, ${data.metadataQueued} métadonnées en queue`);
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Seedbox / Jellyfin</CardTitle>
          <Badge variant={cineClub?.jellyfinApiTokenSet ? 'success' : 'secondary'}>
            {cineClub?.jellyfinApiTokenSet ? 'Configuré' : 'Non configuré'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-zinc-500">Connecte Nasflix à une instance Jellyfin sur ta seedbox pour streamer et télécharger depuis la seedbox au lieu du NAS.</p>
        <div>
          <label className="text-sm text-zinc-400 mb-1 block">URL Jellyfin</label>
          <Input
            placeholder="https://host.pulsedmedia.com/public-user/jellyfin"
            value={jellyfinUrl}
            onChange={(e) => setJellyfinUrl(e.target.value)}
          />
        </div>
        <div>
          <label className="text-sm text-zinc-400 mb-1 block">Token API Jellyfin</label>
          <p className="text-xs text-zinc-500 mb-1">{cineClub?.jellyfinApiTokenSet ? 'Token configuré (masqué)' : 'Aucun token'}</p>
          <Input
            type="password"
            placeholder={cineClub?.jellyfinApiTokenSet ? '••••••••••••••••' : 'Token API Jellyfin'}
            value={jellyfinToken}
            onChange={(e) => setJellyfinToken(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !jellyfinUrl || (!jellyfinToken && !cineClub?.jellyfinApiTokenSet)}
          >
            <Save className="w-4 h-4 mr-2" />
            {saveMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetchStatus()}
            disabled={isCheckingStatus}
          >
            <Wifi className="w-4 h-4 mr-2" />
            {isCheckingStatus ? 'Test...' : 'Tester la connexion'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            {syncMutation.isPending ? 'Synchronisation...' : 'Synchroniser depuis Jellyfin'}
          </Button>
        </div>

        {status && (
          <p className={`text-sm ${status.online ? 'text-green-400' : 'text-destructive'}`}>
            {status.online ? `✓ Connecté — Jellyfin ${status.version ?? ''} (${status.serverName ?? ''})` : '✗ Jellyfin inaccessible'}
          </p>
        )}
        {saveMutation.isSuccess && <p className="text-sm text-green-400">Configuration Jellyfin enregistrée.</p>}
        {saveMutation.isError && (
          <p className="text-sm text-destructive">
            {saveMutation.error instanceof Error ? saveMutation.error.message : 'Erreur'}
          </p>
        )}
        {syncResult && <p className="text-sm text-green-400">{syncResult}</p>}
        {syncMutation.isError && (
          <p className="text-sm text-destructive">
            {syncMutation.error instanceof Error ? syncMutation.error.message : 'Erreur de sync'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Page principale ────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { cineClub } = useAuth();
  const isAdmin = cineClub?.role === 'ADMIN';

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Paramètres</h1>
      {!cineClub && <p className="text-zinc-400">Aucun CineClub sélectionné.</p>}
      {cineClub && (
        <div className="space-y-6">
          <GeneralSettingsCard />
          {isAdmin && <WolCard />}
          {isAdmin && <FreeboxCard />}
          {isAdmin && <JellyfinCard />}
          {isAdmin && <WebhookSecretCard />}
        </div>
      )}
    </div>
  );
}
