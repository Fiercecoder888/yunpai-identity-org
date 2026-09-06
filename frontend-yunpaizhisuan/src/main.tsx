import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppProviders } from './app/providers';
import { App } from './app/App';
import { isMswDemoMode } from './app/runtimeMode';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './styles/tokens.css';
import './styles/global.css';
import { AuthBoundary } from './auth/AuthBoundary';
import { bootstrapAuth } from './auth/useAuthStore';

const disableLegacyMocking = async () => {
  if (!('serviceWorker' in navigator)) {
    return false;
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const unregisterResults = await Promise.allSettled(registrations.map((registration) => registration.unregister()));

    if ('caches' in window) {
      const cacheNames = await window.caches.keys();
      await Promise.allSettled(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
    }

    return (
      navigator.serviceWorker.controller !== null &&
      unregisterResults.some((result) => result.status === 'fulfilled' && result.value)
    );
  } catch {
    return false;
  }
};

const prepareRuntime = async () => {
  if (import.meta.env.VITE_LOCAL_LANGGRAPH === 'true') return true;
  if (!isMswDemoMode()) {
    const reloadWithoutLegacyWorker = await disableLegacyMocking();
    if (reloadWithoutLegacyWorker) {
      window.location.reload();
      return false;
    }
    await bootstrapAuth().catch(() => undefined);
    return true;
  }

  const { worker } = await import('./mocks/browser');
  await worker.start({ onUnhandledRequest: 'bypass' });
  return true;
};

void prepareRuntime().then((shouldRender) => {
  if (!shouldRender) {
    return;
  }

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <AppProviders>
          <AuthBoundary><App /></AuthBoundary>
        </AppProviders>
      </AppErrorBoundary>
    </React.StrictMode>,
  );
});
