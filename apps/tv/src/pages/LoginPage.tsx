import { useEffect, useRef, useState } from 'react';
import { KEY, useRemoteKeys } from '../hooks/useRemoteKeys';
import { login, getHealth } from '../lib/api';
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
  const [visible, setVisible] = useState(false);
  const [health, setHealth] = useState<{ api: boolean | null; nas: 'ok' | 'offline' | 'unknown' | null }>({ api: null, nas: null });

  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  const focusedIdx = FIELDS.indexOf(focusedField);

  useEffect(() => { setTimeout(() => setVisible(true), 50); }, []);

  useEffect(() => {
    getHealth().then((h) => setHealth({ api: h.status === 'ok', nas: h.nas }));
  }, []);

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
      e.preventDefault();
    } else if (e.keyCode === KEY.UP) {
      e.preventDefault();
      setFocusedField(FIELDS[Math.max(0, focusedIdx - 1)]);
    } else if (e.keyCode === KEY.DOWN) {
      e.preventDefault();
      setFocusedField(FIELDS[Math.min(FIELDS.length - 1, focusedIdx + 1)]);
    } else if (e.keyCode === KEY.OK) {
      if (focusedField === 'username') { e.preventDefault(); setFocusedField('password'); }
      else if (focusedField === 'password') { e.preventDefault(); setFocusedField('submit'); }
      else if (focusedField === 'submit') { e.preventDefault(); handleSubmit(); }
    }
  }, [focusedField, focusedIdx, username, password]);

  return (
    <div style={{
      position: 'relative', width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0a0a0e 0%, #14141c 100%)',
      overflow: 'hidden',
    }}>
      {/* Background radials */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background:
          'radial-gradient(ellipse at 75% 25%, rgba(201,59,59,0.12), transparent 50%),' +
          'radial-gradient(ellipse at 25% 75%, rgba(58,150,144,0.06), transparent 50%)',
      }} />
      {/* Film grain */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.012) 0 8px, transparent 8px 16px)',
      }} />

      {/* Logo top-left */}
      <div style={{ position: 'absolute', top: '1.75rem', left: '1.75rem' }}>
        <NasflixLogo size={36} />
      </div>

      {/* NAS status top-right */}
      <div style={{ position: 'absolute', top: '1.75rem', right: '1.75rem', display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
        {/* API status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <span style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: health.api === null ? 'rgba(255,255,255,0.25)' : health.api ? 'var(--green-online)' : '#f87171',
            boxShadow: health.api ? '0 0 6px var(--green-online)' : 'none',
            display: 'inline-block', flexShrink: 0, transition: 'background 0.4s',
          }} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: '0.38rem', color: 'rgba(255,255,255,0.5)' }}>
            {health.api === null ? '…' : health.api ? 'API' : 'API hors ligne'}
          </span>
        </div>
        {/* NAS status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <span style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: health.nas === null ? 'rgba(255,255,255,0.25)'
              : health.nas === 'ok' ? 'var(--green-online)'
              : health.nas === 'offline' ? '#f87171'
              : 'rgba(255,255,255,0.25)',
            boxShadow: health.nas === 'ok' ? '0 0 6px var(--green-online)' : 'none',
            display: 'inline-block', flexShrink: 0, transition: 'background 0.4s',
          }} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: '0.38rem', color: 'rgba(255,255,255,0.5)' }}>
            {health.nas === null ? '…'
              : health.nas === 'ok' ? 'NAS en ligne'
              : health.nas === 'offline' ? 'NAS hors ligne'
              : 'NAS inconnu'}
          </span>
        </div>
      </div>

      {/* Glass card */}
      <div style={{
        width: '22.5rem',
        padding: '2rem 2.25rem',
        borderRadius: '0.5625rem',
        background: 'rgba(14,14,18,0.85)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid var(--line-strong)',
        position: 'relative', zIndex: 2,
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(1rem)',
        transition: 'opacity 0.4s ease, transform 0.4s ease',
      }}>
        <div className="uppercase-eyebrow" style={{ letterSpacing: '0.28em', fontSize: '0.38rem', marginBottom: '0.5rem' }}>
          Bienvenue
        </div>
        <h1 style={{
          fontFamily: 'var(--serif)',
          fontSize: '2.25rem', fontWeight: 400,
          lineHeight: 1.0, marginBottom: '0.25rem',
          color: '#fff', letterSpacing: '-0.02em',
        }}>
          Connexion
        </h1>
        <p style={{ fontSize: '0.5rem', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: '1.375rem', maxWidth: '15rem' }}>
          Identifiez-vous pour accéder à votre catalogue.
        </p>

        {/* Username */}
        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{
            display: 'block', fontSize: '0.375rem',
            color: focusedField === 'username' ? 'var(--text-muted)' : 'var(--text-dim)',
            marginBottom: '0.3125rem',
            letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 600,
            transition: 'color 0.15s',
          }}>
            Identifiant
          </label>
          <div style={{
            height: '2rem', borderRadius: '0.3125rem',
            background: 'rgba(0,0,0,0.4)',
            border: focusedField === 'username'
              ? '1px solid var(--accent)'
              : '1px solid var(--line-strong)',
            display: 'flex', alignItems: 'center', padding: '0 0.6875rem',
            boxShadow: focusedField === 'username'
              ? '0 0 0 3px rgba(177,58,48,0.35), 0 12px 36px rgba(177,58,48,0.2)'
              : 'none',
            transition: 'border-color 0.15s, box-shadow 0.15s',
          }}>
            <input
              ref={usernameRef}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onFocus={() => setFocusedField('username')}
              placeholder="identifiant"
              style={{
                flex: 1, background: 'none', border: 'none', outline: 'none',
                color: 'var(--text)', fontSize: '0.5625rem',
                fontFamily: 'inherit', letterSpacing: '0.04em',
              }}
            />
          </div>
        </div>

        {/* Password */}
        <div style={{ marginBottom: '1rem' }}>
          <label style={{
            display: 'block', fontSize: '0.375rem',
            color: focusedField === 'password' ? 'var(--text-muted)' : 'var(--text-dim)',
            marginBottom: '0.3125rem',
            letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 600,
            transition: 'color 0.15s',
          }}>
            Mot de passe
          </label>
          <div style={{
            height: '2rem', borderRadius: '0.3125rem',
            background: 'rgba(0,0,0,0.4)',
            border: focusedField === 'password'
              ? '1px solid var(--accent)'
              : '1px solid var(--line-strong)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 0.6875rem',
            boxShadow: focusedField === 'password'
              ? '0 0 0 3px rgba(177,58,48,0.35), 0 12px 36px rgba(177,58,48,0.2)'
              : 'none',
            transition: 'border-color 0.15s, box-shadow 0.15s',
          }}>
            <input
              ref={passwordRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setFocusedField('password')}
              placeholder="••••••••"
              style={{
                flex: 1, background: 'none', border: 'none', outline: 'none',
                color: 'var(--text)', fontSize: '0.5625rem',
                fontFamily: 'inherit',
              }}
            />
          </div>
        </div>

        {error && (
          <div style={{
            padding: '0.5rem 0.8rem', borderRadius: '0.25rem',
            background: 'rgba(201,59,59,0.12)', border: '1px solid rgba(201,59,59,0.3)',
            fontSize: '0.47rem', color: '#fca5a5', marginBottom: '0.75rem',
          }}>
            {error}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '0.4375rem' }}>
          <button
            ref={submitRef}
            data-focused={focusedField === 'submit'}
            onFocus={() => setFocusedField('submit')}
            onClick={handleSubmit}
            disabled={loading}
            style={{
              flex: 1, height: '1.875rem', borderRadius: '0.3125rem',
              background: focusedField === 'submit' ? 'var(--accent)' : 'rgba(177,58,48,0.5)',
              border: 'none', color: '#fff',
              fontSize: '0.53rem', fontWeight: 700, letterSpacing: '0.04em',
              cursor: 'pointer',
              outline: focusedField === 'submit' ? '3px solid rgba(255,255,255,0.5)' : 'none',
              outlineOffset: '3px',
              transform: focusedField === 'submit' ? 'scale(1.02)' : 'scale(1)',
              transition: 'all 0.15s ease',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Connexion…' : 'Se connecter'}
          </button>
        </div>

        {/* Hint bar */}
        <div style={{
          marginTop: '1.125rem', paddingTop: '0.625rem',
          borderTop: '1px solid var(--line)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '0.34rem', color: 'rgba(255,255,255,0.3)' }}>
            ▲ ▼ champ · OK saisir
          </span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '0.34rem', color: 'rgba(255,255,255,0.3)' }}>
            JWT · Connexion sécurisée
          </span>
        </div>
      </div>

    </div>
  );
}

function NasflixLogo({ size }: { size: number }) {
  const s = size / 32; // scale factor (base 32px = 1rem)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: `${s * 0.4}rem` }}>
      <svg width={size * 1.1} height={size * 1.1} viewBox="0 0 40 40" fill="none">
        <rect width="40" height="40" rx="9" fill="var(--accent)" />
        <path d="M16 13 L28 20 L16 27 Z" fill="#0c0c10" />
      </svg>
      <span style={{
        fontFamily: 'Inter, sans-serif', fontWeight: 800,
        fontSize: `${s * 0.82}rem`, letterSpacing: '0.02em',
        textTransform: 'uppercase', color: 'var(--text)',
      }}>
        nasflix
      </span>
    </div>
  );
}
