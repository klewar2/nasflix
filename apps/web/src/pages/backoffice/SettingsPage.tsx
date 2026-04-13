import { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Copy, RefreshCw, Save } from 'lucide-react';

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
type FreeboxStep = 'idle' | 'waiting' | 'granted' | 'error';

function FreeboxCard() {
  const { cineClub } = useAuth();
  const [freeboxUrl, setFreeboxUrl] = useState(cineClub?.freeboxApiUrl ?? '');
  const [step, setStep] = useState<FreeboxStep>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const trackIdRef = useRef<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (cineClub) setFreeboxUrl(cineClub.freeboxApiUrl ?? '');
  }, [cineClub]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const authorizeMutation = useMutation({
    mutationFn: () => api.startFreeboxAuthorization(freeboxUrl),
    onSuccess: ({ trackId }) => {
      trackIdRef.current = trackId;
      setStep('waiting');
      pollRef.current = setInterval(async () => {
        try {
          const res = await api.checkFreeboxAuthorizationStatus(trackId);
          if (res.granted) {
            clearInterval(pollRef.current!);
            setStep('granted');
          } else if (res.status === 'denied' || res.status === 'timeout') {
            clearInterval(pollRef.current!);
            setStep('error');
            setErrorMsg(`Autorisation ${res.status}`);
          }
        } catch {
          clearInterval(pollRef.current!);
          setStep('error');
          setErrorMsg('Erreur lors de la vérification du statut');
        }
      }, 3000);
    },
    onError: (e) => {
      setStep('error');
      setErrorMsg(e instanceof Error ? e.message : 'Erreur');
    },
  });

  const handleStart = () => {
    setStep('idle');
    setErrorMsg('');
    authorizeMutation.mutate();
  };

  const handleReset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setStep('idle');
    setErrorMsg('');
    authorizeMutation.reset();
  };

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
      <CardContent className="space-y-4">
        <p className="text-xs text-zinc-500">
          Permet au WoL de passer par la Freebox (méthode fiable depuis internet). Le token est généré automatiquement lors de l'autorisation.
        </p>
        <div>
          <label className="text-sm text-zinc-400 mb-1 block">URL API Freebox</label>
          <Input
            placeholder="https://mafreebox.fbxos.fr"
            value={freeboxUrl}
            onChange={(e) => setFreeboxUrl(e.target.value)}
            disabled={step === 'waiting'}
          />
          <p className="text-xs text-zinc-600 mt-1">
            Champ <code className="bg-zinc-800 px-1 rounded">api_domain</code> retourné par{' '}
            <code className="bg-zinc-800 px-1 rounded">curl http://mafreebox.freebox.fr/api_version</code>
          </p>
        </div>

        {step === 'idle' && (
          <Button size="sm" onClick={handleStart} disabled={!freeboxUrl || authorizeMutation.isPending}>
            {authorizeMutation.isPending ? 'Connexion à la Freebox...' : (cineClub?.freeboxAppTokenSet ? 'Ré-autoriser' : 'Autoriser Nasflix')}
          </Button>
        )}

        {step === 'waiting' && (
          <div className="rounded-md border border-yellow-600 bg-yellow-950/30 p-4 space-y-2">
            <p className="text-sm font-medium text-yellow-400">En attente de votre confirmation</p>
            <p className="text-xs text-zinc-300">
              Regardez l'écran LCD de votre Freebox et appuyez sur <strong>OK</strong> pour autoriser l'application <strong>Nasflix</strong>.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <RefreshCw className="w-3 h-3 animate-spin text-zinc-400" />
              <span className="text-xs text-zinc-400">Vérification toutes les 3 secondes...</span>
            </div>
            <Button size="sm" variant="ghost" onClick={handleReset} className="text-xs">
              Annuler
            </Button>
          </div>
        )}

        {step === 'granted' && (
          <div className="rounded-md border border-green-600 bg-green-950/30 p-4">
            <p className="text-sm font-medium text-green-400">Freebox autorisée avec succès</p>
            <p className="text-xs text-zinc-400 mt-1">Le token a été sauvegardé. Le WoL passera désormais par la Freebox.</p>
            <Button size="sm" variant="ghost" onClick={handleReset} className="text-xs mt-2">
              Reconfigurer
            </Button>
          </div>
        )}

        {step === 'error' && (
          <div className="rounded-md border border-red-800 bg-red-950/30 p-4 space-y-2">
            <p className="text-sm text-destructive">{errorMsg}</p>
            <Button size="sm" variant="ghost" onClick={handleReset} className="text-xs">
              Réessayer
            </Button>
          </div>
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
          {isAdmin && <WebhookSecretCard />}
        </div>
      )}
    </div>
  );
}
