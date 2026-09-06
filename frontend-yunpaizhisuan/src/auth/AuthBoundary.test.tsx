import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from './useAuthStore';
import { renderWithApp } from '../tests/testUtils';
import { AuthBoundary } from './AuthBoundary';
import type { AuthConfig, AuthMe } from './authApi';

const config: AuthConfig = {
  auth_mode: 'shared_anonymous', oidc_enabled: false, shared_data: true, csrf_required: true,
  capabilities: { anonymous_session: true, oidc_login: false, session_management: true, user_isolation: false },
};

const me: AuthMe = {
  auth_mode: 'shared_anonymous', principal_id: 'shared-principal', principal_type: 'shared_anonymous', user: null,
  tenant: { id: 't', name: 'Shared' }, shared_data: true,
  roles: [], permissions: [],
  session: { id: 's', csrf_token: 'c', idle_expires_at: new Date(Date.now() + 4 * 60 * 1000).toISOString(), absolute_expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() },
};

describe('AuthBoundary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAuthStore.setState({ status: 'idle', config: undefined, me: undefined, error: undefined });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('passes children through in demo mode without the session notice', () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubEnv('VITE_ENABLE_MSW', 'true');

    renderWithApp(
      <AuthBoundary>
        <div>app body</div>
      </AuthBoundary>,
    );

    expect(screen.getByText('app body')).toBeInTheDocument();
    expect(screen.queryByText('会话即将过期')).not.toBeInTheDocument();
  });

  it('shows a loading spinner while bootstrap is pending', () => {
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    useAuthStore.setState({ status: 'loading', config: undefined, me: undefined, error: undefined });

    renderWithApp(
      <AuthBoundary>
        <div>app body</div>
      </AuthBoundary>,
    );

    expect(screen.queryByText('app body')).not.toBeInTheDocument();
    expect(document.querySelector('.ant-spin')).toBeInTheDocument();
  });

  it('mounts the session expiry notice when ready in real mode', () => {
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    useAuthStore.setState({ status: 'ready', config, me, error: undefined });

    renderWithApp(
      <AuthBoundary>
        <div>app body</div>
      </AuthBoundary>,
    );

    expect(screen.getByText('app body')).toBeInTheDocument();
    expect(screen.getByText('会话即将过期')).toBeInTheDocument();
  });
});
