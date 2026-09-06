import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authRuntime } from './authRuntime';
import type { AuthConfig, AuthMe } from './authApi';
import { useAuthStore } from './useAuthStore';

const config: AuthConfig = { auth_mode: 'shared_anonymous', oidc_enabled: false, shared_data: true, csrf_required: true,
  capabilities: { anonymous_session: true, oidc_login: false, session_management: true, user_isolation: false } };
const me: AuthMe = { auth_mode: 'shared_anonymous', principal_id: 'shared-principal', principal_type: 'shared_anonymous', user: null,
  tenant: { id: '11111111-1111-4111-8111-111111111111', name: 'Shared' }, shared_data: true,
  roles: ['shared_developer'], permissions: ['chat:read'],
  session: { id: 'public', csrf_token: 'runtime-csrf', idle_expires_at: 'later', absolute_expires_at: 'later' } };

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

describe('auth bootstrap', () => {
  beforeEach(() => {
    authRuntime.setCsrfToken(undefined);
    useAuthStore.setState({ status: 'idle', config: undefined, me: undefined, error: undefined });
    vi.restoreAllMocks();
  });

  it('creates one anonymous session after me returns 401 and keeps CSRF in memory', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(config))
      .mockResolvedValueOnce(json({ code: 'session_required' }, 401))
      .mockResolvedValueOnce(json(me))
      .mockResolvedValueOnce(json(me));
    await useAuthStore.getState().bootstrap();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      '/api/auth/config', '/api/auth/me', '/api/auth/session/anonymous', '/api/auth/me',
    ]);
    expect(useAuthStore.getState()).toMatchObject({ status: 'ready', me });
    expect(authRuntime.getCsrfToken()).toBe('runtime-csrf');
    expect(localStorage.getItem('runtime-csrf')).toBeNull();
  });

  it('fails closed on 403 without creating an anonymous session', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(config)).mockResolvedValueOnce(json({}, 403));
    await expect(useAuthStore.getState().bootstrap()).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState().status).toBe('error');
  });

  it('refreshes CSRF from the current cookie without rotating an already-valid session', async () => {
    authRuntime.setCsrfToken('stale-runtime-csrf');
    useAuthStore.setState({ status: 'ready', config, me, error: undefined });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(me));

    await expect(useAuthStore.getState().recoverAnonymousSession()).resolves.toBe(true);

    const recoveryHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/me');
    expect(recoveryHeaders.get('X-CSRF-Token')).toBe('stale-runtime-csrf');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('creates a new anonymous session only after the current cookie returns 401', async () => {
    authRuntime.setCsrfToken('stale-runtime-csrf');
    useAuthStore.setState({ status: 'ready', config, me, error: undefined });
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ code: 'session_required' }, 401))
      .mockResolvedValueOnce(json(me))
      .mockResolvedValueOnce(json(me));

    await expect(useAuthStore.getState().recoverAnonymousSession()).resolves.toBe(true);

    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      '/api/auth/me', '/api/auth/session/anonymous', '/api/auth/me',
    ]);
  });

  it('exposes an error state when the BFF is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('connection refused'));
    await expect(useAuthStore.getState().bootstrap()).rejects.toThrow('connection refused');
    expect(useAuthStore.getState()).toMatchObject({ status: 'error', error: 'connection refused' });
  });
});
