import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './utils/mediaDevices';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';
import { registerOpenZapServiceWorker } from './utils/browserNotifications';

void registerOpenZapServiceWorker();

/** Impede zoom com Ctrl+roda (desktop / PWA Windows) sem afetar scroll normal. */
if (typeof document !== 'undefined') {
  document.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { passive: false }
  );
}

const rootEl = document.getElementById('root');
if (!rootEl) {
  document.body.innerHTML = '<p style="color:#fff;padding:24px">Elemento #root em falta.</p>';
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <BrowserRouter>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </BrowserRouter>
    </StrictMode>
  );
}
