import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authRuntime } from '../../auth/authRuntime';
import { useAuthStore } from '../../auth/useAuthStore';
import type { AuthConfig, AuthMe } from '../../auth/authApi';
import { computeSessionTimerState, extendSession, formatRemaining, useSessionTimer } from './useSessionTimer';

const config: AuthConfig = {
  auth_mode: 'shared_anonymous', oidc_enabled: false, shared_data: true, csrf_required: true,
  capabilities: { anonymous_session: true, oidc_login: false, session_management: true, user_isolation: false },
};

const me: AuthMe = {
  auth_mode: 'shared_anonymous', principal_id: 'shared-principal', principal_type: 'shared_anonymous', user: null,
  tenant: { id: 't', name: 'Shared' }, shared_data: true,
  roles: [], permissions: [],
  session: { id: 's', csrf_token: 'c', idle_expires_at: 'later', absolute_expires_at: 'later' },
};

const iso = (ms: number) => new Date(ms).toISOString();
const now = () => Date.now();

describe('computeSessionTimerState', () => {
  it('is active when idle and absolute are far in the future', () => {
    const state = computeSessionTimerState(now(), {
      idle_expires_at: iso(now() + 30 * 60 * 1000),
      absolute_expires_at: iso(now() + 2 * 60 * 60 * 1000),
    });
    expect(state.phase).toBe('active');
    expect(state.expiryKind).toBeNull();
  });

  it('warns when idle expiry is within the warning window', () => {
    const state = computeSessionTimerState(now(), {
      idle_expires_at: iso(now() + 4 * 60 * 1000),
      absolute_expires_at: iso(now() + 2 * 60 * 60 * 1000),
    });
    expect(state.phase).toBe('warning');
    expect(state.expiryKind).toBe('idle');
    expect(state.idleRemainingMs).toBeGreaterThan(0);
    expect(state.idleRemainingMs).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it('is active when only absolute expiry exists', () => {
    const state = computeSessionTimerState(now(), {
      absolute_expires_at: iso(now() + 2 * 60 * 60 * 1000),
    });
    expect(state.phase).toBe('active');
    expect(state.expiryKind).toBeNull();
  });

  it('expires when the idle deadline passes', () => {
    const state = computeSessionTimerState(now(), {
      idle_expires_at: iso(now() - 1000),
      absolute_expires_at: iso(now() + 2 * 60 * 60 * 1000),
    });
    expect(state.phase).toBe('expired');
    expect(state.expiryKind).toBe('idle');
    expect(state.idleRemainingMs).toBeLessThan(0);
  });

  it('expires as absolute when the absolute deadline passes even if idle is still valid', () => {
    const state = computeSessionTimerState(now(), {
      idle_expires_at: iso(now() + 10 * 60 * 1000),
      absolute_expires_at: iso(now() - 1000),
    });
    expect(state.phase).toBe('expired');
    expect(state.expiryKind).toBe('absolute');
    expect(state.absoluteRemainingMs).toBeLessThan(0);
  });

  it('treats missing timing as active', () => {
    expect(computeSessionTimerState(now(), undefined).phase).toBe('active');
    expect(computeSessionTimerState(now(), { absolute_expires_at: iso(now() + 60 * 1000) }).phase).toBe('active');
  });
});

describe('useSessionTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ticks and moves from warning to expired as time advances', () => {
    const start = Date.now();
    vi.setSystemTime(start);
    const { result } = renderHook(() =>
      useSessionTimer({
        idle_expires_at: iso(start + 2 * 60 * 1000),
        absolute_expires_at: iso(start + 60 * 60 * 1000),
      }),
    );

    expect(result.current.phase).toBe('warning');

    act(() => {
      vi.setSystemTime(start + 3 * 60 * 1000);
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.phase).toBe('expired');
    expect(result.current.expiryKind).toBe('idle');
  });
});

describe('formatRemaining', () => {
  it('formats a positive remaining duration as minutes and seconds', () => {
    expect(formatRemaining(4 * 60 * 1000 + 30 * 1000)).toBe('4 分 30 秒');
  });

  it('clamps negative values to zero', () => {
    expect(formatRemaining(-1000)).toBe('0 分 0 秒');
  });
});

describe('extendSession', () => {
  beforeEach(() => {
    authRuntime.setCsrfToken(undefined);
    useAuthStore.setState({ status: 'idle', config: undefined, me: undefined, error: undefined });
    vi.restoreAllMocks();
  });

  it('rebuilds an anonymous session via authRuntime.recover in shared_anonymous mode', async () => {
    useAuthStore.setState({ status: 'ready', config, me, error: undefined });
    const recoverSpy = vi.spyOn(authRuntime, 'recover').mockResolvedValue(true);

    await expect(extendSession('/c/abc')).resolves.toEqual({ outcome: 'recovered' });
    expect(recoverSpy).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable when anonymous recovery fails', async () => {
    useAuthStore.setState({ status: 'ready', config, me, error: undefined });
    vi.spyOn(authRuntime, 'recover').mockResolvedValue(false);

    await expect(extendSession()).resolves.toEqual({ outcome: 'unavailable' });
  });

  it('offers the OIDC login jump for federated principals', async () => {
    useAuthStore.setState({
      status: 'ready',
      config: { ...config, capabilities: { ...config.capabilities, oidc_login: true } },
      me: { ...me, principal_type: 'oidc_federated' },
      error: undefined,
    });

    await expect(extendSession('/c/abc')).resolves.toEqual({
      outcome: 'relogin',
      url: '/api/auth/login?return_to=%2Fc%2Fabc',
    });
  });

  it('returns unavailable when no session is present', async () => {
    await expect(extendSession()).resolves.toEqual({ outcome: 'unavailable' });
  });
});
