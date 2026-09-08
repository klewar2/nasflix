import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  stack: string;
}

/**
 * Sans ce garde-fou, la moindre exception de rendu démonte tout l'arbre React et
 * laisse un écran noir muet — impossible à diagnostiquer sur une TV. On affiche
 * l'erreur à l'écran (les vieux webOS n'ont pas d'inspecteur accessible).
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Nasflix] Erreur de rendu :', error, info.componentStack);
    this.setState({ stack: info.componentStack ?? '' });
  }

  render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, left: 0,
        background: '#07070a', color: '#fff', padding: '3rem',
        fontFamily: 'var(--mono), monospace', overflow: 'auto',
      }}>
        <div style={{ color: '#e50914', fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>
          Nasflix — erreur inattendue
        </div>
        <div style={{ fontSize: '0.6rem', marginBottom: '1rem', wordBreak: 'break-word' }}>
          {error.message}
        </div>
        <pre style={{
          fontSize: '0.42rem', color: 'rgba(255,255,255,0.45)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
        }}>
          {(error.stack ?? '') + stack}
        </pre>
      </div>
    );
  }
}
