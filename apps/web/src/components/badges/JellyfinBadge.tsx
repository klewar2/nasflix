import { cn } from '@/lib/utils';

interface JellyfinBadgeProps {
  jellyfinItemId?: string | null;
  className?: string;
}

export function JellyfinBadge({ jellyfinItemId, className }: JellyfinBadgeProps) {
  return (
    <span
      title={jellyfinItemId ? `Jellyfin ID: ${jellyfinItemId}` : 'Disponible sur Jellyfin'}
      className={cn(
        'inline-flex items-center gap-1 rounded bg-violet-700/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-50',
        className,
      )}
    >
      Jellyfin
    </span>
  );
}
