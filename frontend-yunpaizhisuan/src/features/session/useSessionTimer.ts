import { useEffect, useState } from 'react';
import { authRuntime } from '../../auth/authRuntime';
import { oidcLoginUrl } from '../../auth/authApi';
import { useAuthStore } from '../../auth/useAuthStore';

export const SESSION_WARN_BEFORE_MS = 5 * 60 * 1000;
export const SESSION_TICK_MS = 1000;

export type SessionPhase = 'active' | 'warning' | 'expired';
export type SessionExpiryKind = 'idle' | 'absolute';

export type SessionTiming = { idle_expires_at?: string; absolute_expires_at?: string };

export type SessionTimerState = {
  phase: SessionPhase;
  idleRemainingMs: number;
  absoluteRemainingMs: number;
  expiryKind: SessionExpiryKind | null;
};

const parseTime = (value: string | undefined) => {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
};

export function computeSessionTimerState(
  now: number,
  session: SessionTiming | undefined,
  warnBeforeMs = SESSION_WARN_BEFORE_MS,
): SessionTimerState {
  const idleAt = parseTime(session?.idle_expires_at);
  const absoluteAt = parseTime(session?.absolute_expires_at);
  const idleRemainingMs = idleAt === undefined ? Number.POSITIVE_INFINITY : idleAt - now;
  const absoluteRemainingMs = absoluteAt === undefined ? Number.POSITIVE_INFINITY : absoluteAt - now;

  const absoluteExpired = absoluteAt !== undefined && absoluteRemainingMs <= 0;
  const idleExpired = idleAt !== undefined && idleRemainingMs <= 0;
  const expired = absoluteExpired || idleExpired;
  const warning = !expired && idleAt !== undefined && idleRemainingMs <= warnBeforeMs;
  const phase: SessionPhase = expired ? 'expired' : warning ? 'warning' : 'active';
  const expiryKind: SessionExpiryKind | null = expired ? (absoluteExpired ? 'absolute' : 'idle') : warning ? 'idle' : null;

  return { phase, idleRemainingMs, absoluteRemainingMs, expiryKind };
}

export function useSessionTimer(
  session: SessionTiming | undefined,
  options: { warnBeforeMs?: number; tickMs?: number } = {},
): SessionTimerState {
  const warnBeforeMs = options.warnBeforeMs ?? SESSION_WARN_BEFORE_MS;
  const tickMs = options.tickMs ?? SESSION_TICK_MS;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), tickMs);
    return () => window.clearInterval(timer);
  }, [tickMs]);

  return computeSessionTimerState(now, session, warnBeforeMs);
}

export function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes} 分 ${seconds} 秒`;
}

export type ExtendSessionResult =
  | { outcome: 'recovered' }
  | { outcome: 'relogin'; url: string }
  | { outcome: 'unavailable' };

export function defaultReturnTo() {
  return `${window.location.pathname}${window.location.search}`;
}

export async function extendSession(returnTo = defaultReturnTo()): Promise<ExtendSessionResult> {
  const { config, me } = useAuthStore.getState();
  if (!config || !me) return { outcome: 'unavailable' };
  if (me.principal_type === 'oidc_federated' || config.capabilities.oidc_login) {
    return { outcome: 'relogin', url: oidcLoginUrl(returnTo) };
  }
  if (config.auth_mode === 'shared_anonymous' && config.capabilities.anonymous_session) {
    const recovered = await authRuntime.recover();
    return recovered ? { outcome: 'recovered' } : { outcome: 'unavailable' };
  }
  return { outcome: 'unavailable' };
}
