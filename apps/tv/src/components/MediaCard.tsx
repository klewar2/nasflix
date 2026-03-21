import { memo } from 'react';

interface Props {
  media: {
    id: number;
    title: string;
    posterUrl?: string;
    releaseYear?: number;
    voteAverage?: number;
    type: 'movie' | 'series';
  };
  focused: boolean;
  onFocus: () => void;
  onSelect: () => void;
}

function MediaCard({ media, focused, onFocus, onSelect }: Props) {
  return (
    <div
      data-focused={focused}
      tabIndex={0}
      onFocus={onFocus}
      onClick={onSelect}
      style={{
        width: '10rem',
        flexShrink: 0,
        cursor: 'pointer',
        borderRadius: '8px',
        overflow: 'hidden',
        position: 'relative',
        outline: focused ? '3px solid var(--red)' : '3px solid transparent',
        outlineOffset: '3px',
        transition: 'outline 0.12s ease, box-shadow 0.18s ease',
        zIndex: focused ? 10 : 1,
        willChange: 'transform',
        boxShadow: focused
          ? '0 12px 40px rgba(229,9,20,0.4), 0 4px 16px rgba(0,0,0,0.6)'
          : '0 2px 10px rgba(0,0,0,0.5)',
      }}
    >
      {/* Poster */}
      {media.posterUrl ? (
        <img
          src={media.posterUrl}
          alt={media.title}
          style={{ width: '100%', aspectRatio: '2/3', objectFit: 'cover', display: 'block' }}
          loading="lazy"
        />
      ) : (
        <div style={{
          width: '100%', aspectRatio: '2/3',
          background: 'linear-gradient(135deg, #27272a, #18181b)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0.75rem', textAlign: 'center',
          color: 'rgba(255,255,255,0.5)', fontSize: '0.5rem',
        }}>
          {media.title}
        </div>
      )}

      {/* Netflix-style overlay: always shows type badge, on focus shows full info */}
      <div style={{
        position: 'absolute', inset: 0,
        background: focused
          ? 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.4) 50%, transparent 100%)'
          : 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%)',
        transition: 'background 0.2s ease',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        padding: '0.5rem',
      }}>
        {/* Type badge */}
        <span style={{
          position: 'absolute', top: '0.4rem', right: '0.4rem',
          fontSize: '0.38rem', fontWeight: 800,
          padding: '0.15rem 0.4rem', borderRadius: '3px',
          background: media.type === 'series' ? 'rgba(59,130,246,0.85)' : 'rgba(229,9,20,0.85)',
          color: '#fff', textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          {media.type === 'series' ? 'Série' : 'Film'}
        </span>

        {/* Info (always visible at bottom) */}
        <p style={{
          fontSize: '0.45rem',
          fontWeight: 700,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          color: '#fff',
          marginBottom: focused ? '0.25rem' : '0',
        }}>
          {media.title}
        </p>
        {focused && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {media.releaseYear && (
              <span style={{ fontSize: '0.38rem', color: 'rgba(255,255,255,0.55)' }}>{media.releaseYear}</span>
            )}
            {media.voteAverage && media.voteAverage > 0 && (
              <span style={{ fontSize: '0.38rem', color: '#fbbf24', fontWeight: 700 }}>★ {media.voteAverage.toFixed(1)}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(MediaCard);
