import { useEffect, useRef, useState } from 'react';
import MediaCard from './MediaCard';
import { KEY, useRemoteKeys } from '../hooks/useRemoteKeys';

interface Media {
  id: number;
  title: string;
  posterPath?: string;
  releaseYear?: number;
  type: 'movie' | 'series';
}

interface Props {
  title: string;
  items: Media[];
  rowFocused: boolean;
  onSelect: (media: Media) => void;
  onUp?: () => void;
  onDown?: () => void;
}

export default function MediaRow({ title, items, rowFocused, onSelect, onUp, onDown }: Props) {
  const [focusedIdx, setFocusedIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll focused card into view
  useEffect(() => {
    if (!rowFocused || !scrollRef.current) return;
    const cards = scrollRef.current.querySelectorAll<HTMLElement>('[data-card]');
    cards[focusedIdx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [focusedIdx, rowFocused]);

  useRemoteKeys(
    (e) => {
      if (!rowFocused) return;
      if (e.keyCode === KEY.LEFT) {
        e.preventDefault();
        setFocusedIdx((i) => Math.max(0, i - 1));
      } else if (e.keyCode === KEY.RIGHT) {
        e.preventDefault();
        setFocusedIdx((i) => Math.min(items.length - 1, i + 1));
      } else if (e.keyCode === KEY.UP) {
        e.preventDefault();
        onUp?.();
      } else if (e.keyCode === KEY.DOWN) {
        e.preventDefault();
        onDown?.();
      } else if (e.keyCode === KEY.OK) {
        e.preventDefault();
        onSelect(items[focusedIdx]);
      }
    },
    [rowFocused, focusedIdx, items, onUp, onDown],
  );

  return (
    <div style={{ marginBottom: '2rem' }}>
      <h2
        style={{
          fontSize: '0.9rem',
          fontWeight: 700,
          marginBottom: '0.75rem',
          paddingLeft: '3rem',
          color: rowFocused ? 'var(--text)' : 'var(--text-muted)',
        }}
      >
        {title}
      </h2>
      <div
        ref={scrollRef}
        style={{
          display: 'flex',
          gap: '0.75rem',
          paddingLeft: '3rem',
          paddingRight: '3rem',
          overflowX: 'hidden',
        }}
      >
        {items.map((media, idx) => (
          <div key={media.id} data-card>
            <MediaCard
              media={media}
              focused={rowFocused && focusedIdx === idx}
              onFocus={() => setFocusedIdx(idx)}
              onSelect={() => onSelect(media)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
