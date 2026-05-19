import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import type { MediaResponse } from '@nasflix/shared';
import { NasBadge } from '@/components/badges/NasBadge';
import { JellyfinBadge } from '@/components/badges/JellyfinBadge';

interface MediaCardProps {
  media: MediaResponse;
  className?: string;
}

export function MediaCard({ media, className }: MediaCardProps) {
  const onNas = media.sourceType === 'NAS' && !media.nasDeletedAt;
  const onJellyfin = !!media.jellyfinItemId;
  const showBadges = onNas || onJellyfin || media.nasDeletedAt;

  return (
    <Link
      to={`/media/${media.id}`}
      className={cn(
        'group relative flex-shrink-0 overflow-hidden rounded-md transition-transform duration-300 hover:scale-105 hover:z-10',
        className,
      )}
    >
      <div className="aspect-[2/3] w-full">
        {media.posterUrl ? (
          <img
            src={media.posterUrl}
            alt={media.titleVf || media.titleOriginal}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-zinc-800 text-zinc-500">
            <span className="text-center text-sm px-2">{media.titleVf || media.titleOriginal}</span>
          </div>
        )}
      </div>
      {showBadges && (
        <div className="absolute left-1.5 top-1.5 flex flex-col gap-1">
          {onNas && <NasBadge nasPath={media.nasPath} />}
          {media.nasDeletedAt && !onNas && <NasBadge nasPath={media.nasPath} deleted />}
          {onJellyfin && <JellyfinBadge jellyfinItemId={media.jellyfinItemId} />}
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100">
        <div className="absolute bottom-0 w-full p-3">
          <p className="text-sm font-semibold truncate">{media.titleVf || media.titleOriginal}</p>
          <div className="flex items-center gap-2 text-xs text-zinc-400 mt-1">
            {media.releaseYear && <span>{media.releaseYear}</span>}
            {media.voteAverage && <span>{media.voteAverage.toFixed(1)}</span>}
            {media.runtime && <span>{media.runtime} min</span>}
          </div>
          {media.genres && media.genres.length > 0 && (
            <div className="flex gap-1 mt-1 flex-wrap">
              {media.genres.slice(0, 2).map((g) => (
                <span key={g.genre.id} className="text-[10px] bg-zinc-700 px-1.5 py-0.5 rounded">
                  {g.genre.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
