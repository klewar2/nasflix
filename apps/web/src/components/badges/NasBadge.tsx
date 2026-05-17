import { cn } from '@/lib/utils';

interface NasBadgeProps {
  nasPath?: string | null;
  deleted?: boolean;
  className?: string;
}

export function NasBadge({ nasPath, deleted, className }: NasBadgeProps) {
  return (
    <span
      title={nasPath ?? 'Disponible sur le NAS'}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        deleted
          ? 'bg-zinc-700/80 text-zinc-300 line-through'
          : 'bg-emerald-700/90 text-emerald-50',
        className,
      )}
    >
      NAS
    </span>
  );
}
