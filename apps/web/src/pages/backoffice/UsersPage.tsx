import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { UserPlus, Trash2, ChevronDown, ChevronUp, Save } from 'lucide-react';
import type { UserResponse, CineClubMemberResponse } from '@nasflix/shared';

interface UserEditForm {
  username: string;
  firstName: string;
  lastName: string;
  password: string;
}

interface MemberEditForm {
  role: 'ADMIN' | 'VIEWER';
  nasUsername: string;
  nasPassword: string;
}

export default function UsersPage() {
  const queryClient = useQueryClient();
  const { user: currentUser, cineClub } = useAuth();

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.getUsers(),
  });

  const { data: members } = useQuery({
    queryKey: ['cineclubMembers', cineClub?.id],
    queryFn: () => (cineClub ? api.getCineClubMembers(cineClub.id) : Promise.resolve([])),
    enabled: !!cineClub,
  });

  // ── Mon compte ────────────────────────────────────────────────
  const [myAccountForm, setMyAccountForm] = useState<UserEditForm>({
    username: currentUser?.username ?? '',
    firstName: currentUser?.firstName ?? '',
    lastName: currentUser?.lastName ?? '',
    password: '',
  });
  const [myAccountError, setMyAccountError] = useState('');

  const updateMyAccountMutation = useMutation({
    mutationFn: () => {
      if (!currentUser) throw new Error('Non connecté');
      return api.updateUser(currentUser.id, {
        username: myAccountForm.username || undefined,
        firstName: myAccountForm.firstName || undefined,
        lastName: myAccountForm.lastName || undefined,
        password: myAccountForm.password || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setMyAccountForm((p) => ({ ...p, password: '' }));
      setMyAccountError('');
    },
    onError: (err: Error) => setMyAccountError(err.message),
  });

  // ── Édition d'un utilisateur ──────────────────────────────────
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [userEditForm, setUserEditForm] = useState<UserEditForm>({ username: '', firstName: '', lastName: '', password: '' });
  const [userEditError, setUserEditError] = useState('');

  const openUserEdit = (u: UserResponse) => {
    setEditingUserId(u.id);
    setUserEditForm({ username: u.username, firstName: u.firstName, lastName: u.lastName, password: '' });
    setUserEditError('');
  };

  const updateUserMutation = useMutation({
    mutationFn: (userId: number) =>
      api.updateUser(userId, {
        username: userEditForm.username || undefined,
        firstName: userEditForm.firstName || undefined,
        lastName: userEditForm.lastName || undefined,
        password: userEditForm.password || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditingUserId(null);
      setUserEditError('');
    },
    onError: (err: Error) => setUserEditError(err.message),
  });

  // ── Création d'un utilisateur ─────────────────────────────────
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', firstName: '', lastName: '', password: '', isSuperAdmin: false });
  const [createError, setCreateError] = useState('');

  const createUserMutation = useMutation({
    mutationFn: () => api.createUser(newUser),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setNewUser({ username: '', firstName: '', lastName: '', password: '', isSuperAdmin: false });
      setShowCreateForm(false);
      setCreateError('');
    },
    onError: (err: Error) => setCreateError(err.message),
  });

  // ── Ajout d'un membre ─────────────────────────────────────────
  const [showAddMember, setShowAddMember] = useState(false);
  const [addMemberForm, setAddMemberForm] = useState({
    userId: '',
    role: 'VIEWER' as 'ADMIN' | 'VIEWER',
    nasUsername: '',
    nasPassword: '',
  });
  const [addMemberError, setAddMemberError] = useState('');

  const addMemberMutation = useMutation({
    mutationFn: () => {
      if (!cineClub) throw new Error('Aucun CineClub sélectionné');
      return api.addCineClubMember(cineClub.id, {
        userId: parseInt(addMemberForm.userId),
        role: addMemberForm.role,
        nasUsername: addMemberForm.nasUsername || undefined,
        nasPassword: addMemberForm.nasPassword || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cineclubMembers', cineClub?.id] });
      setAddMemberForm({ userId: '', role: 'VIEWER', nasUsername: '', nasPassword: '' });
      setShowAddMember(false);
      setAddMemberError('');
    },
    onError: (err: Error) => setAddMemberError(err.message),
  });

  // ── Édition d'un membre (rôle + NAS) ─────────────────────────
  const [editingMemberId, setEditingMemberId] = useState<number | null>(null);
  const [memberEditForm, setMemberEditForm] = useState<MemberEditForm>({ role: 'VIEWER', nasUsername: '', nasPassword: '' });
  const [memberEditError, setMemberEditError] = useState('');

  const openMemberEdit = (member: CineClubMemberResponse) => {
    setEditingMemberId(member.id);
    setMemberEditForm({ role: member.role as 'ADMIN' | 'VIEWER', nasUsername: member.nasUsername ?? '', nasPassword: '' });
    setMemberEditError('');
  };

  const updateMemberMutation = useMutation({
    mutationFn: (userId: number) => {
      if (!cineClub) throw new Error('Aucun CineClub sélectionné');
      return api.updateCineClubMember(cineClub.id, userId, {
        role: memberEditForm.role,
        nasUsername: memberEditForm.nasUsername || undefined,
        nasPassword: memberEditForm.nasPassword || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cineclubMembers', cineClub?.id] });
      setEditingMemberId(null);
      setMemberEditError('');
    },
    onError: (err: Error) => setMemberEditError(err.message),
  });

  // ── Suppression ───────────────────────────────────────────────
  const removeMemberMutation = useMutation({
    mutationFn: (userId: number) => {
      if (!cineClub) throw new Error('Aucun CineClub sélectionné');
      return api.removeCineClubMember(cineClub.id, userId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cineclubMembers', cineClub?.id] }),
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId: number) => api.deleteUser(userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const isMember = (u: UserResponse) =>
    members?.some((m: CineClubMemberResponse) => m.user.id === u.id) ?? false;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Utilisateurs</h1>
      <div className="space-y-6">

        {/* ── Mon compte ── */}
        <Card>
          <CardHeader>
            <CardTitle>Mon compte</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Nom d'utilisateur</label>
                <Input
                  value={myAccountForm.username}
                  onChange={(e) => setMyAccountForm((p) => ({ ...p, username: e.target.value }))}
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
                  value={myAccountForm.password}
                  onChange={(e) => setMyAccountForm((p) => ({ ...p, password: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Prénom</label>
                <Input
                  value={myAccountForm.firstName}
                  onChange={(e) => setMyAccountForm((p) => ({ ...p, firstName: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Nom</label>
                <Input
                  value={myAccountForm.lastName}
                  onChange={(e) => setMyAccountForm((p) => ({ ...p, lastName: e.target.value }))}
                />
              </div>
            </div>
            {myAccountError && <p className="text-sm text-destructive">{myAccountError}</p>}
            {updateMyAccountMutation.isSuccess && <p className="text-sm text-green-400">Compte mis à jour</p>}
            <Button
              size="sm"
              onClick={() => updateMyAccountMutation.mutate()}
              disabled={updateMyAccountMutation.isPending}
            >
              <Save className="w-4 h-4 mr-2" />
              {updateMyAccountMutation.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
            </Button>
          </CardContent>
        </Card>

        {/* ── Membres du CineClub ── */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Membres — {cineClub?.name}</CardTitle>
            <Button size="sm" onClick={() => setShowAddMember(!showAddMember)}>
              <UserPlus className="w-4 h-4 mr-2" />
              Ajouter
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">

            {showAddMember && (
              <div className="p-4 border border-white/10 rounded-lg space-y-3">
                <h3 className="text-sm font-semibold text-zinc-300">Ajouter un membre</h3>
                <select
                  className="w-full bg-zinc-800 text-white border border-white/10 rounded px-3 py-2 text-sm"
                  value={addMemberForm.userId}
                  onChange={(e) => setAddMemberForm((p) => ({ ...p, userId: e.target.value }))}
                >
                  <option value="">Sélectionner un utilisateur</option>
                  {users?.filter((u: UserResponse) => !isMember(u)).map((u: UserResponse) => (
                    <option key={u.id} value={u.id}>
                      {u.username} — {u.firstName} {u.lastName}
                    </option>
                  ))}
                </select>
                <select
                  className="w-full bg-zinc-800 text-white border border-white/10 rounded px-3 py-2 text-sm"
                  value={addMemberForm.role}
                  onChange={(e) => setAddMemberForm((p) => ({ ...p, role: e.target.value as 'ADMIN' | 'VIEWER' }))}
                >
                  <option value="VIEWER">Spectateur</option>
                  <option value="ADMIN">Administrateur</option>
                </select>
                <Input
                  placeholder="Identifiant NAS (optionnel)"
                  value={addMemberForm.nasUsername}
                  onChange={(e) => setAddMemberForm((p) => ({ ...p, nasUsername: e.target.value }))}
                />
                <Input
                  type="password"
                  placeholder="Mot de passe NAS (optionnel)"
                  value={addMemberForm.nasPassword}
                  onChange={(e) => setAddMemberForm((p) => ({ ...p, nasPassword: e.target.value }))}
                />
                {addMemberError && <p className="text-sm text-destructive">{addMemberError}</p>}
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => addMemberMutation.mutate()} disabled={!addMemberForm.userId || addMemberMutation.isPending}>
                    Ajouter
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowAddMember(false)}>Annuler</Button>
                </div>
              </div>
            )}

            {members?.length === 0 && <p className="text-zinc-500 text-sm">Aucun membre.</p>}

            {members?.map((member: CineClubMemberResponse) => {
              const isEditing = editingMemberId === member.id;
              const isMe = member.user.id === currentUser?.id;
              return (
                <div key={member.id} className="border border-white/5 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-white/[0.03]">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white">{member.user.username}</p>
                        {isMe && <span className="text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">Moi</span>}
                      </div>
                      <p className="text-xs text-zinc-400">
                        {member.user.firstName} {member.user.lastName}
                        {member.nasUsername && <span className="ml-2 text-zinc-500">· NAS : {member.nasUsername}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={member.role === 'ADMIN' ? 'default' : 'secondary'}>
                        {member.role === 'ADMIN' ? 'Admin' : 'Spectateur'}
                      </Badge>
                      <Button size="sm" variant="ghost" onClick={() => (isEditing ? setEditingMemberId(null) : openMemberEdit(member))}>
                        {isEditing ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>
                      {!isMe && (
                        <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Retirer "${member.user.username}" du CineClub ?`)) removeMemberMutation.mutate(member.user.id); }}>
                          <Trash2 className="w-4 h-4 text-red-400" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {isEditing && (
                    <div className="px-4 py-4 border-t border-white/5 space-y-3">
                      <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Accès CineClub</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-zinc-400 mb-1 block">Rôle</label>
                          <select
                            className="w-full bg-zinc-800 text-white border border-white/10 rounded px-3 py-2 text-sm"
                            value={memberEditForm.role}
                            onChange={(e) => setMemberEditForm((p) => ({ ...p, role: e.target.value as 'ADMIN' | 'VIEWER' }))}
                          >
                            <option value="VIEWER">Spectateur</option>
                            <option value="ADMIN">Administrateur</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-zinc-400 mb-1 block">Identifiant NAS</label>
                          <Input value={memberEditForm.nasUsername} onChange={(e) => setMemberEditForm((p) => ({ ...p, nasUsername: e.target.value }))} />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="text-xs text-zinc-400 mb-1 block">
                            Mot de passe NAS
                            <span className="ml-1 text-zinc-600">(laisser vide pour conserver)</span>
                          </label>
                          <Input type="password" placeholder="Nouveau mot de passe NAS" value={memberEditForm.nasPassword} onChange={(e) => setMemberEditForm((p) => ({ ...p, nasPassword: e.target.value }))} />
                        </div>
                      </div>
                      {memberEditError && <p className="text-sm text-destructive">{memberEditError}</p>}
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => updateMemberMutation.mutate(member.user.id)} disabled={updateMemberMutation.isPending}>
                          <Save className="w-4 h-4 mr-2" />
                          {updateMemberMutation.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingMemberId(null)}>Annuler</Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* ── Tous les utilisateurs (SuperAdmin uniquement) ── */}
        {currentUser?.isSuperAdmin && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Tous les utilisateurs</CardTitle>
              <Button size="sm" onClick={() => setShowCreateForm(!showCreateForm)}>
                <UserPlus className="w-4 h-4 mr-2" />
                Créer
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {showCreateForm && (
                <div className="p-4 border border-white/10 rounded-lg space-y-3">
                  <h3 className="text-sm font-semibold text-zinc-300">Nouvel utilisateur</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input placeholder="Nom d'utilisateur" value={newUser.username} onChange={(e) => setNewUser((p) => ({ ...p, username: e.target.value }))} />
                    <Input type="password" placeholder="Mot de passe" value={newUser.password} onChange={(e) => setNewUser((p) => ({ ...p, password: e.target.value }))} />
                    <Input placeholder="Prénom" value={newUser.firstName} onChange={(e) => setNewUser((p) => ({ ...p, firstName: e.target.value }))} />
                    <Input placeholder="Nom" value={newUser.lastName} onChange={(e) => setNewUser((p) => ({ ...p, lastName: e.target.value }))} />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
                    <input type="checkbox" checked={newUser.isSuperAdmin} onChange={(e) => setNewUser((p) => ({ ...p, isSuperAdmin: e.target.checked }))} />
                    Super Admin
                  </label>
                  {createError && <p className="text-sm text-destructive">{createError}</p>}
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => createUserMutation.mutate()} disabled={!newUser.username || !newUser.password || createUserMutation.isPending}>
                      Créer
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowCreateForm(false)}>Annuler</Button>
                  </div>
                </div>
              )}

              {users?.map((u: UserResponse) => {
                const isEditing = editingUserId === u.id;
                const isMe = u.id === currentUser?.id;
                return (
                  <div key={u.id} className="border border-white/5 rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 bg-white/[0.03]">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-white">{u.username}</p>
                          {isMe && <span className="text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">Moi</span>}
                        </div>
                        <p className="text-xs text-zinc-400">{u.firstName} {u.lastName}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {u.isSuperAdmin && <Badge variant="destructive">SuperAdmin</Badge>}
                        {isMember(u) && <Badge variant="secondary">Membre</Badge>}
                        <Button size="sm" variant="ghost" onClick={() => (isEditing ? setEditingUserId(null) : openUserEdit(u))}>
                          {isEditing ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </Button>
                        {!isMe && (
                          <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Supprimer définitivement "${u.username}" ?`)) deleteUserMutation.mutate(u.id); }}>
                            <Trash2 className="w-4 h-4 text-red-400" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {isEditing && (
                      <div className="px-4 py-4 border-t border-white/5 space-y-3">
                        <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Modifier le compte</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs text-zinc-400 mb-1 block">Nom d'utilisateur</label>
                            <Input value={userEditForm.username} onChange={(e) => setUserEditForm((p) => ({ ...p, username: e.target.value }))} />
                          </div>
                          <div>
                            <label className="text-xs text-zinc-400 mb-1 block">
                              Nouveau mot de passe
                              <span className="ml-1 text-zinc-600">(laisser vide pour conserver)</span>
                            </label>
                            <Input type="password" placeholder="••••••••" value={userEditForm.password} onChange={(e) => setUserEditForm((p) => ({ ...p, password: e.target.value }))} />
                          </div>
                          <div>
                            <label className="text-xs text-zinc-400 mb-1 block">Prénom</label>
                            <Input value={userEditForm.firstName} onChange={(e) => setUserEditForm((p) => ({ ...p, firstName: e.target.value }))} />
                          </div>
                          <div>
                            <label className="text-xs text-zinc-400 mb-1 block">Nom</label>
                            <Input value={userEditForm.lastName} onChange={(e) => setUserEditForm((p) => ({ ...p, lastName: e.target.value }))} />
                          </div>
                        </div>
                        {userEditError && <p className="text-sm text-destructive">{userEditError}</p>}
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => updateUserMutation.mutate(u.id)} disabled={updateUserMutation.isPending}>
                            <Save className="w-4 h-4 mr-2" />
                            {updateUserMutation.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingUserId(null)}>Annuler</Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  );
}
