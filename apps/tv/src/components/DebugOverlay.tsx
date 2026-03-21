import { useEffect, useState } from 'react';

interface KeyEvent {
  keyCode: number;
  key: string;
  name: string;
  ts: number;
  defaultPrevented: boolean;
}

const KEY_NAMES: Record<number, string> = {
  13: 'OK / Enter',
  37: 'LEFT ←',
  38: 'UP ↑',
  39: 'RIGHT →',
  40: 'DOWN ↓',
  403: '🔴 RED',
  404: '🟢 GREEN',
  405: '🟡 YELLOW',
  406: '🔵 BLUE',
  412: '⏮ RW',
  413: '⏹ STOP',
  415: '▶ PLAY',
  417: '⏭ FF',
  457: 'ℹ️ INFO',
  461: '⬅ BACK / RETURN',
  10009: 'RETURN (alt)',
  10252: '⏯ PLAY_PAUSE',
  19: '⏸ PAUSE',
};

export default function DebugOverlay() {
  const [visible, setVisible] = useState(true);
  const [events, setEvents] = useState<KeyEvent[]>([]);
  const [backBlocked, setBackBlocked] = useState(false);

  useEffect(() => {
    // Monitor all key events (before global blocker via same capture phase, same order)
    const captureHandler = (e: KeyboardEvent) => {
      const isBack = e.keyCode === 461 || e.keyCode === 10009;
      if (isBack) setBackBlocked(true);

      // Toggle debug with RED button
      if (e.keyCode === 403) {
        setVisible((v) => !v);
        return;
      }

      setEvents((prev) => [
        {
          keyCode: e.keyCode,
          key: e.key,
          name: KEY_NAMES[e.keyCode] || `Unknown`,
          ts: Date.now(),
          defaultPrevented: e.defaultPrevented,
        },
        ...prev,
      ].slice(0, 8));
    };

    // Use capture phase but after main.tsx global handler (same phase, FIFO order)
    document.addEventListener('keydown', captureHandler, true);
    return () => document.removeEventListener('keydown', captureHandler, true);
  }, []);

  if (!visible) {
    return (
      <div style={{
        position: 'fixed', bottom: '12px', right: '12px', zIndex: 9999,
        background: 'rgba(0,0,0,0.6)', color: 'rgba(255,255,255,0.4)',
        padding: '4px 8px', borderRadius: '4px', fontSize: '10px',
        fontFamily: 'monospace',
      }}>
        🔴 Debug off
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', bottom: '12px', right: '12px', zIndex: 9999,
      background: 'rgba(0,0,0,0.92)',
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: '8px',
      padding: '10px 14px',
      minWidth: '280px',
      fontFamily: 'monospace',
      pointerEvents: 'none',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', fontWeight: 700, color: '#e50914', letterSpacing: '0.1em' }}>
          DEBUG KEYS
        </span>
        <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)' }}>🔴 toggle</span>
      </div>

      {/* BACK status */}
      <div style={{
        marginBottom: '6px', padding: '4px 8px', borderRadius: '4px',
        background: backBlocked ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
        border: `1px solid ${backBlocked ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
        fontSize: '10px', color: backBlocked ? '#86efac' : '#fca5a5',
      }}>
        BACK (461): {backBlocked ? '✓ intercepté (preventDefault OK)' : '⚠ pas encore reçu'}
      </div>

      {/* Key events list */}
      {events.length === 0 && (
        <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', textAlign: 'center', padding: '4px' }}>
          Appuie sur une touche…
        </div>
      )}
      {events.map((ev, i) => (
        <div key={ev.ts + i} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '3px 0',
          opacity: i === 0 ? 1 : 0.5 - i * 0.05,
          borderBottom: i < events.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
        }}>
          <span style={{ fontSize: '11px', color: '#fff', fontWeight: i === 0 ? 700 : 400 }}>
            {ev.name || ev.key}
          </span>
          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
            {ev.keyCode}
          </span>
        </div>
      ))}
    </div>
  );
}
