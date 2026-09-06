import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authRuntime } from '../../auth/authRuntime';
import { useAuthStore } from '../../auth/useAuthStore';
import type { AuthConfig, AuthMe } from '../../auth/authApi';
import { renderWithApp } from '../../tests/testUtils';
import { SessionExpiryNotice } from './SessionExpiryNotice';

const config: AuthConfig = {
  auth_mode: 'shared_anonymous', oidc_enabled: false, shared_data: true, csrf_required: true,
  capabilities: { anonymous_session: true, oidc_login: false, session_management: true, user_isolation: false },
};

const me: AuthMe = {
  auth_mode: 'shared_anonymous', principal_id: 'shared-principal', principal_type: 'shared_anonymous', user: null,
  tenant: { id: 't', name: 'Shared' }, shared_data: true,
  roles: [], permissions: [],
  session: { id: 's', csrf_token: 'c', idle_expires_at: '', absolute_expires_at: '' },
};

const iso = (ms: number) => new Date(ms).toISOString();

const setReadySession = (session: Partial<AuthMe['session']> = {}) => {
  useAuthStore.setState({
    status: 'ready',
    config,
    me: { ...me, session: { id: 's', csrf_token: 'c', idle_expires_at: iso(Date.now() + 60 * 60 * 1000), absolute_expires_at: iso(Date.now() + 2 * 60 * 60 * 1000), ...session } },
    error: undefined,
  });
};

describe('SessionExpiryNotice', () => {
  beforeEach(() => {
    authRuntime.setCsrfToken(undefined);
    vi.restoreAllMocks();
    vi.spyOn(window, 'setInterval').mockReturnValue(0 as unknown as ReturnType<typeof setInterval>);
    useAuthStore.setState({ status: 'idle', config: undefined, me: undefined, error: undefined });
  });

  it('shows nothing when the session is far from expiry', () => {
    setReadySession({
      idle_expires_at: iso(Date.now() + 30 * 60 * 1000),
      absolute_expires_at: iso(Date.now() + 2 * 60 * 60 * 1000),
    });
    renderWithApp(<SessionExpiryNotice />);

    expect(screen.queryByText('会话即将过期')).not.toBeInTheDocument();
    expect(screen.queryByText('会话已过期')).not.toBeInTheDocument();
  });

  it('shows a countdown warning before idle expiry and rebuilds the session on demand', async () => {
    setReadySession({
      idle_expires_at: iso(Date.now() + 4 * 60 * 1000 + 30 * 1000),
      absolute_expires_at: iso(Date.now() + 2 * 60 * 60 * 1000),
    });
    const recoverSpy = vi.spyOn(authRuntime, 'recover').mockResolvedValue(true);
    renderWithApp(<SessionExpiryNotice />);

    expect(screen.getByRole('alert')).toHaveClass('session-expiry-warning');
    expect(screen.getByText('会话即将过期')).toBeInTheDocument();
    expect(screen.getByText(/闲置会话将在 4 分 30 秒 后过期/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '续期/刷新' }));
      await Promise.resolve();
    });
    expect(recoverSpy).toHaveBeenCalledTimes(1);
  });

  it('dismisses the warning after the user closes it', () => {
    setReadySession({
      idle_expires_at: iso(Date.now() + 4 * 60 * 1000),
      absolute_expires_at: iso(Date.now() + 2 * 60 * 60 * 1000),
    });
    renderWithApp(<SessionExpiryNotice />);

    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(screen.queryByText('会话即将过期')).not.toBeInTheDocument();
  });

  it('shows an expired message when the absolute deadline passes', () => {
    setReadySession({
      idle_expires_at: iso(Date.now() + 10 * 60 * 1000),
      absolute_expires_at: iso(Date.now() - 1000),
    });
    renderWithApp(<SessionExpiryNotice />);

    expect(screen.getByRole('dialog', { name: '会话已过期' })).toBeInTheDocument();
    expect(screen.getByText('会话已过期，请重新登录或刷新页面。')).toBeInTheDocument();
  });

  it('navigates to the OIDC login URL when the session is federated and expired', async () => {
    const assignSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign: assignSpy },
    });
    useAuthStore.setState({
      status: 'ready',
      config: { ...config, capabilities: { ...config.capabilities, oidc_login: true } },
      me: { ...me, principal_type: 'oidc_federated', session: { id: 's', csrf_token: 'c', idle_expires_at: iso(Date.now() + 4 * 60 * 1000), absolute_expires_at: iso(Date.now() - 1000) } },
      error: undefined,
    });
    renderWithApp(<SessionExpiryNotice />);

    expect(screen.getByText('会话已过期')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '去登录' }));
      await Promise.resolve();
    });

    expect(assignSpy).toHaveBeenCalledWith('/api/auth/login?return_to=%2F');
  });
});
