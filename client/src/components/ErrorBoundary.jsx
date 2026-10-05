import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('OpenZap:', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-full flex-col items-center justify-center overflow-x-hidden bg-whatsapp-dark px-6 text-center text-whatsapp-text touch-manipulation">
          <h1 className="text-lg font-medium">Algo correu mal</h1>
          <p className="mt-2 max-w-md text-sm text-whatsapp-text-secondary">
            Recarregue a página. Se voltar a acontecer, abra a consola do navegador (F12) e envie o erro.
          </p>
          <pre className="mt-4 max-h-40 max-w-full overflow-auto rounded-lg bg-black/40 p-3 text-left text-xs text-red-200/90">
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 rounded-xl bg-whatsapp-green px-6 py-2.5 text-sm font-semibold text-whatsapp-on-primary"
          >
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
