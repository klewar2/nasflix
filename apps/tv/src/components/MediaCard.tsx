import { useRef } from 'react';

interface Props {
  media: {
    id: number;
    title: string;
    posterPath?: string;
    releaseYear?: number;
    type: 'movie' | 'series';
  };
  focused: boolean;
  onFocus: () => void;
  onSelect: () => void;
}

const TMDB_IMG = 'https://image.tmdb.org/t/p/w300';

export default function MediaCard({ media, focused, onFocus, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      data-focused={focused}
      tabIndex={0}
      onFocus={onFocus}
      onClick={onSelect}
      style={{
        width: '11rem',
        flexShrink: 0,
        cursor: 'pointer',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        background: 'var(--bg-card)',
        outline: focused ? 'var(--focus-ring)' : 'none',
        outlineOffset: '4px',
        transform: focused ? 'scale(1.06)' : 'scale(1)',
        transition: 'transform 0.15s ease, outline 0.1s ease',
        zIndex: focused ? 10 : 1,
        position: 'relative',
      }}
    >
      {media.posterPath ? (
        <img
          src={`${TMDB_IMG}${media.posterPath}`}
          alt={media.title}
          style={{ width: '100%', aspectRatio: '2/3', objectFit: 'cover', display: 'block' }}
          loading="lazy"
        />
      ) : (
        <div
          style={{
            width: '100%',
            aspectRatio: '2/3',
            background: '#27272a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-dim)',
            fontSize: '0.75rem',
            padding: '0.5rem',
            textAlign: 'center',
          }}
        >
          {media.title}
        </div>
      )}
      <div style={{ padding: '0.4rem 0.5rem 0.5rem' }}>
        <div
          style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {media.title}
        </div>
        {media.releaseYear && (
          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
            {media.releaseYear}
          </div>
        )}
      </div>
    </div>
  );
}
