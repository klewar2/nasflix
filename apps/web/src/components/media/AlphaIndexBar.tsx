import { cn } from '@/lib/utils';

const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];

interface AlphaIndexBarProps {
  availableLetters: Set<string>;
  activeLetter: string | null;
  onLetterClick: (letter: string) => void;
}

export function AlphaIndexBar({ availableLetters, activeLetter, onLetterClick }: AlphaIndexBarProps) {
  return (
    <div className="sticky top-16 z-40 bg-zinc-950/90 backdrop-blur-md border-b border-white/5">
      <div className="px-4 md:px-8 py-2 flex gap-0.5 overflow-x-auto scrollbar-none">
        {LETTERS.map((letter) => {
          const hasContent = availableLetters.has(letter);
          const isActive = activeLetter === letter;
          return (
            <button
              key={letter}
              onClick={() => hasContent && onLetterClick(letter)}
              disabled={!hasContent}
              className={cn(
                'min-w-[28px] h-7 rounded text-xs font-bold transition-all duration-200 flex-shrink-0 flex items-center justify-center',
                isActive
                  ? 'bg-[#e50914] text-white shadow-md shadow-red-900/50 scale-110'
                  : hasContent
                  ? 'text-zinc-300 hover:bg-white/10 hover:text-white cursor-pointer'
                  : 'text-zinc-700 cursor-default',
              )}
            >
              {letter}
            </button>
          );
        })}
      </div>
    </div>
  );
}
