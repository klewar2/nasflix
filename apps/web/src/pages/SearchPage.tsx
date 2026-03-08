import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { MediaCard } from '@/components/media/MediaCard';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/hooks/use-debounce';
import { Search } from 'lucide-react';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);

  const { data, isLoading } = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: () => api.searchMedia(debouncedQuery),
    enabled: debouncedQuery.length >= 2,
  });

  return (
    <div className="px-4 md:px-8 py-6">
      <div className="max-w-xl mx-auto mb-8">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
          <Input
            type="text"
            placeholder="Rechercher un film ou une série..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10 h-12 text-lg bg-zinc-900"
            autoFocus
          />
        </div>
      </div>

      {isLoading && debouncedQuery.length >= 2 && <p className="text-center text-zinc-500">Recherche en cours...</p>}
      {data && data.data.length === 0 && debouncedQuery.length >= 2 && <p className="text-center text-zinc-500">Aucun résultat pour "{debouncedQuery}"</p>}

      {data && data.data.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {data.data.map((m: any) => <MediaCard key={m.id} media={m} />)}
        </div>
      )}

      {!debouncedQuery && <p className="text-center text-zinc-600 mt-20">Commence à taper pour rechercher</p>}
    </div>
  );
}
