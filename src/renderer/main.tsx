import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    // Financial content is never sent to external telemetry.
  }
  override render() {
    return this.state.failed ? (
      <div className="startup">
        <h1>Ekran açıla bilmədi</h1>
        <p>Uçot bazası ayrıca saxlanılır və bu xətadan təsirlənmir.</p>
        <button type="button" className="button primary" onClick={() => window.location.reload()}>
          Yenidən aç
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
