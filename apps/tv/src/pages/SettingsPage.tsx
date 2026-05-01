import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPreferences, updatePreferences } from '../lib/api';
import { KEY, useRemoteKeys } from '../hooks/useRemoteKeys';

interface Props {
  onBack: () => void;
}

const OPTIONS: { value: 'NATIVE' | 'DIRECT'; label: string; desc: string }[] = [
  { value: 'NATIVE', label: 'Natif (HLS)', desc: 'Force HLS · badge HDR · plus de ressources serveur' },
  { value: 'DIRECT', label: 'Direct Play (Dolby Vision)', desc: 'Fichier brut · badge Dolby Vision · moins de charge serveur' },
];

export default function SettingsPage({ onBack }: Props) {
  const queryClient = useQueryClient();
  const [focusIdx, setFocusIdx] = useState(0);

  const { data: prefs } = useQuery({
    queryKey: ['preferences'],
    queryFn: getPreferences,
  });

  const mutation = useMutation({
    mutationFn: (q: 'NATIVE' | 'DIRECT') => updatePreferences(q),
    onSuccess: (data) => queryClient.setQueryData(['preferences'], data),
  });

  const current = prefs?.streamingQuality ?? 'NATIVE';

  useRemoteKeys((e) => {
    if (e.keyCode === KEY.UP) {
      e.preventDefault();
      setFocusIdx((i) => Math.max(0, i - 1));
    } else if (e.keyCode === KEY.DOWN) {
      e.preventDefault();
      setFocusIdx((i) => Math.min(OPTIONS.length - 1, i + 1));
    } else if (e.keyCode === KEY.OK) {
      e.preventDefault();
      mutation.mutate(OPTIONS[focusIdx].value);
    } else if (e.keyCode === KEY.BACK) {
      e.preventDefault();
      onBack();
    }
  }, [focusIdx]);

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      padding: '2.5rem 3rem',
      color: 'var(--text)',
      background: 'var(--bg)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button
          onClick={onBack}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: '0.55rem', padding: '0.3rem 0.6rem',
            borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '0.3rem',
          }}
        >
          ← Retour
        </button>
        <h1 style={{ fontSize: '0.75rem', fontWeight: 700, margin: 0 }}>Paramètres</h1>
      </div>

      <div style={{ maxWidth: '28rem' }}>
        <p style={{ fontSize: '0.45rem', color: 'var(--text-muted)', marginBottom: '1.2rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Qualité streaming Jellyfin (TV)
        </p>
        <p style={{ fontSize: '0.38rem', color: 'var(--text-dim)', marginBottom: '1.5rem' }}>
          Conditionne les codecs envoyés à Jellyfin. Si le serveur est surchargé, utilisez Direct Play.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {OPTIONS.map((opt, idx) => {
            const isSelected = current === opt.value;
            const isFocused = focusIdx === idx;
            return (
              <button
                key={opt.value}
                onClick={() => { setFocusIdx(idx); mutation.mutate(opt.value); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.9rem',
                  padding: '0.8rem 1rem',
                  background: isSelected ? 'rgba(229,9,20,0.12)' : 'rgba(255,255,255,0.03)',
                  border: `1.5px solid ${isFocused ? 'var(--accent)' : isSelected ? 'rgba(229,9,20,0.4)' : 'var(--line-strong)'}`,
                  borderRadius: '8px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  outline: 'none',
                  boxShadow: isFocused ? '0 0 0 4px rgba(229,9,20,0.15)' : 'none',
                  transition: 'border-color 0.12s, box-shadow 0.12s',
                }}
              >
                {/* Radio dot */}
                <div style={{
                  width: '0.55rem', height: '0.55rem', borderRadius: '50%', flexShrink: 0,
                  border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--text-dim)'}`,
                  background: isSelected ? 'var(--accent)' : 'transparent',
                  transition: 'background 0.12s, border-color 0.12s',
                }} />
                <div>
                  <p style={{ fontSize: '0.46rem', fontWeight: isSelected ? 700 : 500, color: isSelected ? '#fff' : 'var(--text)', margin: 0 }}>
                    {opt.label}
                  </p>
                  <p style={{ fontSize: '0.35rem', color: 'var(--text-dim)', margin: '0.15rem 0 0' }}>
                    {opt.desc}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {mutation.isSuccess && (
          <p style={{ marginTop: '1rem', fontSize: '0.38rem', color: '#4ade80' }}>
            Préférence enregistrée.
          </p>
        )}
      </div>
    </div>
  );
}
