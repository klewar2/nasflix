import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Save } from 'lucide-react';

export default function MyProfilePage() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();

  const [form, setForm] = useState({
    username: currentUser?.username ?? '',
    firstName: currentUser?.firstName ?? '',
    lastName: currentUser?.lastName ?? '',
    password: '',
  });
  const [error, setError] = useState('');

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!currentUser) throw new Error('Non connecté');
      return api.updateUser(currentUser.id, {
        username: form.username || undefined,
        firstName: form.firstName || undefined,
        lastName: form.lastName || undefined,
        password: form.password || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setForm((p) => ({ ...p, password: '' }));
      setError('');
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Mon profil</h1>
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Modifier mon compte</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Nom d'utilisateur</label>
              <Input
                value={form.username}
                onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">
                Nouveau mot de passe
                <span className="ml-1 text-zinc-600">(laisser vide pour conserver)</span>
              </label>
              <Input
                type="password"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Prénom</label>
              <Input
                value={form.firstName}
                onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Nom</label>
              <Input
                value={form.lastName}
                onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))}
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {updateMutation.isSuccess && <p className="text-sm text-green-400">Profil mis à jour</p>}
          <Button
            size="sm"
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
          >
            <Save className="w-4 h-4 mr-2" />
            {updateMutation.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
