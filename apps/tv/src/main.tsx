import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './tv.css';

// ── BACK key: History API approach (webOS recommended) ───────────────────
// webOS triggers 'popstate' when BACK is pressed (History API mode).
// We push an initial state, then re-push on each popstate to prevent
// system exit. We also dispatch a synthetic keydown(461) so useRemoteKeys
// handlers fire normally.
history.pushState(null, '');
window.addEventListener('popstate', () => {
  history.pushState(null, ''); // re-push → prevents system exit dialog
  // Dispatch synthetic BACK keydown so useRemoteKeys handlers fire
  document.dispatchEvent(new KeyboardEvent('keydown', {
    keyCode: 461, which: 461, bubbles: true, cancelable: true,
  }));
});

// Fallback: also block raw keydown for older webOS versions that send keyCode directly
document.addEventListener('keydown', (e) => {
  if (e.keyCode === 461 || e.keyCode === 10009) e.preventDefault();
}, true);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5 * 60 * 1000 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
