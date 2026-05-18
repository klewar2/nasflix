import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Hauteur réservée tant que les enfants ne sont pas montés (place un placeholder à la bonne taille pour éviter les sauts de scroll). */
  placeholderHeight: number | string;
  /** Marge autour du viewport déclenchant le mount. Default: 1 viewport. */
  rootMargin?: string;
  /** Si fourni, parent scrollable utilisé comme root. Sinon, viewport. */
  rootRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

/**
 * Monte ses enfants quand le placeholder approche du viewport via IntersectionObserver,
 * puis reste monté (one-shot). Réduit la taille du DOM initial sur les écrans lourds.
 */
export default function LazyMount({ placeholderHeight, rootMargin = '600px', rootRef, children }: Props) {
  const placeholderRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (mounted) return;
    const el = placeholderRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setMounted(true);
          observer.disconnect();
        }
      },
      { root: rootRef?.current ?? null, rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [mounted, rootMargin, rootRef]);

  if (mounted) return <>{children}</>;
  return (
    <div
      ref={placeholderRef}
      style={{
        height: typeof placeholderHeight === 'number' ? `${placeholderHeight}px` : placeholderHeight,
      }}
    />
  );
}
