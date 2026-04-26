import { useEffect, useState } from 'react';

interface Props {
  onDone: () => void;
}

export default function SplashScreen({ onDone }: Props) {
  const [phase, setPhase] = useState<'in' | 'hold' | 'out'>('in');

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('hold'), 300);
    const t2 = setTimeout(() => setPhase('out'), 2600);
    const t3 = setTimeout(onDone, 3100);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(ellipse at center, #14141c 0%, #07070a 70%)',
      overflow: 'hidden',
      opacity: phase === 'out' ? 0 : 1,
      transition: phase === 'out' ? 'opacity 0.5s ease' : 'none',
    }}>
      {/* Soft glow */}
      <div style={{
        position: 'absolute', top: '-30%', left: '50%', transform: 'translateX(-50%)',
        width: '43.75rem', height: '43.75rem',
        background: 'radial-gradient(circle, rgba(201,59,59,0.08), transparent 60%)',
        filter: 'blur(40px)', pointerEvents: 'none',
      }} />

      {/* Concentric rings */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        {([8.125, 11.875, 16.25, 21.875] as number[]).map((r, i) => (
          <div key={r} style={{
            position: 'absolute',
            width: `${r}rem`, height: `${r}rem`, borderRadius: '50%',
            border: `1px solid rgba(255,255,255,${0.05 - i * 0.01})`,
          }} />
        ))}
      </div>

      {/* Main content */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.125rem', zIndex: 2,
        opacity: phase === 'in' ? 0 : 1,
        transform: phase === 'in' ? 'scale(0.92)' : 'scale(1)',
        transition: 'opacity 0.5s ease, transform 0.5s ease',
      }}>
        {/* Logo */}
        <svg
          width="96" height="96" viewBox="0 0 40 40" fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ filter: 'drop-shadow(0 0 24px rgba(177,58,48,0.5))' }}
        >
          <rect width="40" height="40" rx="9" fill="var(--accent)" />
          <path d="M16 13 L28 20 L16 27 Z" fill="#0c0c10" />
        </svg>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.375rem' }}>
          <div className="uppercase-eyebrow" style={{ fontSize: '0.44rem', letterSpacing: '0.32em', color: 'rgba(255,255,255,0.45)' }}>
            Cinéclub privé
          </div>

          {/* Animated loading bar */}
          <div style={{
            width: '8.75rem', height: '2px',
            background: 'rgba(255,255,255,0.08)', borderRadius: '2px',
            overflow: 'hidden', marginTop: '0.25rem',
          }}>
            <div style={{
              width: '38%', height: '100%',
              background: 'var(--accent)',
              boxShadow: '0 0 12px var(--accent)',
              animation: 'splash-progress 2.4s ease-in-out infinite',
            }} />
          </div>

          <div style={{
            fontFamily: 'var(--mono)', fontSize: '0.375rem',
            color: 'rgba(255,255,255,0.3)', marginTop: '0.125rem',
          }}>
            Connexion au NAS…
          </div>
        </div>
      </div>

      {/* Bottom version info */}
      <div style={{
        position: 'absolute', bottom: '1.25rem', left: 0, right: 0,
        display: 'flex', justifyContent: 'space-between',
        padding: '0 2rem',
        opacity: phase === 'hold' ? 1 : 0,
        transition: 'opacity 0.4s ease 0.3s',
      }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '0.34rem', color: 'rgba(255,255,255,0.25)' }}>
          v 2.4.0 · webOS 6+
        </span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '0.34rem', color: 'rgba(255,255,255,0.25)' }}>
          nas.synology · DS920+
        </span>
      </div>

      <style>{`
        @keyframes splash-progress {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(100%); }
          100% { transform: translateX(280%); }
        }
      `}</style>
    </div>
  );
}
