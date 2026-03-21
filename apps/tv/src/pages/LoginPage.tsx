import { useEffect, useRef, useState } from 'react';
import { KEY, useRemoteKeys } from '../hooks/useRemoteKeys';
import { login } from '../lib/api';
import { tokens } from '../lib/tokens';

interface Props {
  onLogin: () => void;
}

const FIELDS = ['username', 'password', 'submit'] as const;
type Field = typeof FIELDS[number];

export default function LoginPage({ onLogin }: Props) {
  const [focusedField, setFocusedField] = useState<Field>('username');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  const focusedIdx = FIELDS.indexOf(focusedField);

  // Focus l'élément actif pour ouvrir le clavier virtuel webOS
  useEffect(() => {
    if (focusedField === 'username') usernameRef.current?.focus();
    else if (focusedField === 'password') passwordRef.current?.focus();
    else if (focusedField === 'submit') submitRef.current?.focus();
  }, [focusedField]);

  const handleSubmit = async () => {
    if (!username || !password) return;
    setLoading(true);
    setError('');
    try {
      const res = await login(username, password);
      tokens.set(res.accessToken, res.refreshToken);
      onLogin();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Identifiants incorrects');
    } finally {
      setLoading(false);
    }
  };

  useRemoteKeys((e) => {
    if (e.keyCode === KEY.BACK) {
      e.preventDefault(); // Ne pas quitter l'app depuis le login
    } else if (e.keyCode === KEY.UP) {
      e.preventDefault();
      setFocusedField(FIELDS[Math.max(0, focusedIdx - 1)]);
    } else if (e.keyCode === KEY.DOWN) {
      e.preventDefault();
      setFocusedField(FIELDS[Math.min(FIELDS.length - 1, focusedIdx + 1)]);
    } else if (e.keyCode === KEY.OK) {
      if (focusedField === 'username') {
        e.preventDefault();
        setFocusedField('password');
      } else if (focusedField === 'password') {
        e.preventDefault();
        setFocusedField('submit');
      } else if (focusedField === 'submit') {
        e.preventDefault();
        handleSubmit();
      }
    }
  }, [focusedField, focusedIdx, username, password]);

  const inputStyle = (active: boolean): React.CSSProperties => ({
    width: '100%',
    padding: '0.9rem 1rem',
    background: active ? '#27272a' : 'var(--bg-card)',
    border: `3px solid ${active ? 'var(--red)' : '#3f3f46'}`,
    borderRadius: 'var(--radius)',
    color: 'var(--text)',
    fontSize: '1rem',
    outline: 'none',
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', background: 'var(--bg)' }}>
      <div style={{ width: '34rem', display: 'flex', flexDirection: 'column', gap: '1.8rem' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
          <svg width="72" height="88" viewBox="0 0 100 120" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="8" y="0" width="22" height="120" fill="#e50914" />
            <polygon points="30,0 70,120 52,120 12,0" fill="#e50914" />
            <rect x="70" y="0" width="22" height="120" fill="#e50914" />
          </svg>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, letterSpacing: '0.15em', marginTop: '0.5rem' }}>NASFLIX</div>
        </div>

        <h1 style={{ textAlign: 'center', fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-muted)' }}>Connexion</h1>

        <div>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Nom d'utilisateur
          </label>
          <input
            ref={usernameRef}
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            data-focused={focusedField === 'username'}
            onFocus={() => setFocusedField('username')}
            style={inputStyle(focusedField === 'username')}
          />
        </div>

        <div>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Mot de passe
          </label>
          <input
            ref={passwordRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-focused={focusedField === 'password'}
            onFocus={() => setFocusedField('password')}
            style={inputStyle(focusedField === 'password')}
          />
        </div>

        {error && (
          <p style={{ color: 'var(--red)', fontSize: '0.85rem', textAlign: 'center', background: 'rgba(229,9,20,0.1)', padding: '0.6rem', borderRadius: 'var(--radius)' }}>
            {error}
          </p>
        )}

        <button
          ref={submitRef}
          data-focused={focusedField === 'submit'}
          onFocus={() => setFocusedField('submit')}
          onClick={handleSubmit}
          disabled={loading}
          style={{
            padding: '0.9rem',
            background: focusedField === 'submit' ? 'var(--red)' : '#27272a',
            border: `3px solid ${focusedField === 'submit' ? 'var(--red)' : '#3f3f46'}`,
            borderRadius: 'var(--radius)',
            color: 'var(--text)',
            fontSize: '1rem',
            fontWeight: 700,
            cursor: 'pointer',
            transform: focusedField === 'submit' ? 'scale(1.03)' : 'scale(1)',
            transition: 'all 0.15s ease',
          }}
        >
          {loading ? 'Connexion…' : 'Se connecter'}
        </button>

        <p style={{ textAlign: 'center', fontSize: '0.7rem', color: 'var(--text-dim)' }}>
          ↑↓ naviguer · OK valider
        </p>
      </div>
    </div>
  );
}
