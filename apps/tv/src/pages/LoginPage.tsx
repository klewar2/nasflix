import { useState } from 'react';
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

  const focusedIdx = FIELDS.indexOf(focusedField);

  const handleSubmit = async () => {
    if (!username || !password) return;
    setLoading(true);
    setError('');
    try {
      const res = await login(username, password);
      tokens.set(res.accessToken, res.refreshToken);
      onLogin();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  };

  useRemoteKeys((e) => {
    if (e.keyCode === KEY.UP) {
      e.preventDefault();
      setFocusedField(FIELDS[Math.max(0, focusedIdx - 1)]);
    } else if (e.keyCode === KEY.DOWN) {
      e.preventDefault();
      setFocusedField(FIELDS[Math.min(FIELDS.length - 1, focusedIdx + 1)]);
    } else if (e.keyCode === KEY.OK && focusedField === 'submit') {
      e.preventDefault();
      handleSubmit();
    }
  }, [focusedField, focusedIdx, username, password]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        background: 'var(--bg)',
      }}
    >
      <div style={{ width: '28rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
          <svg width="60" height="72" viewBox="0 0 100 120" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="8" y="0" width="22" height="120" fill="#e50914" />
            <polygon points="30,0 70,120 52,120 12,0" fill="#e50914" />
            <rect x="70" y="0" width="22" height="120" fill="#e50914" />
          </svg>
        </div>

        <h1 style={{ textAlign: 'center', fontSize: '1.2rem', fontWeight: 700 }}>Connexion</h1>

        {/* Username */}
        <div>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
            Nom d'utilisateur
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            data-focused={focusedField === 'username'}
            onFocus={() => setFocusedField('username')}
            style={{
              width: '100%',
              padding: '0.65rem 0.85rem',
              background: focusedField === 'username' ? '#27272a' : 'var(--bg-card)',
              border: `2px solid ${focusedField === 'username' ? 'var(--red)' : 'transparent'}`,
              borderRadius: 'var(--radius)',
              color: 'var(--text)',
              fontSize: '0.9rem',
              outline: 'none',
            }}
          />
        </div>

        {/* Password */}
        <div>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
            Mot de passe
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-focused={focusedField === 'password'}
            onFocus={() => setFocusedField('password')}
            style={{
              width: '100%',
              padding: '0.65rem 0.85rem',
              background: focusedField === 'password' ? '#27272a' : 'var(--bg-card)',
              border: `2px solid ${focusedField === 'password' ? 'var(--red)' : 'transparent'}`,
              borderRadius: 'var(--radius)',
              color: 'var(--text)',
              fontSize: '0.9rem',
              outline: 'none',
            }}
          />
        </div>

        {error && (
          <p style={{ color: 'var(--red)', fontSize: '0.8rem', textAlign: 'center' }}>{error}</p>
        )}

        {/* Submit button */}
        <button
          data-focused={focusedField === 'submit'}
          onFocus={() => setFocusedField('submit')}
          onClick={handleSubmit}
          disabled={loading}
          style={{
            padding: '0.75rem',
            background: focusedField === 'submit' ? 'var(--red)' : '#27272a',
            border: `2px solid ${focusedField === 'submit' ? 'var(--red)' : 'transparent'}`,
            borderRadius: 'var(--radius)',
            color: 'var(--text)',
            fontSize: '0.9rem',
            fontWeight: 700,
            cursor: 'pointer',
            transform: focusedField === 'submit' ? 'scale(1.03)' : 'scale(1)',
            transition: 'all 0.15s ease',
          }}
        >
          {loading ? 'Connexion...' : 'Se connecter'}
        </button>
      </div>
    </div>
  );
}
