import { authRuntime } from './authRuntime';

export type AuthConfig = {
  auth_mode: 'shared_anonymous' | 'authenticated_isolated';
  oidc_enabled: boolean;
  shared_data: boolean;
  csrf_required: boolean;
  capabilities: {
    anonymous_session: boolean;
    oidc_login: boolean;
    session_management: boolean;
    user_isolation: boolean;
  };
  tenants?: Array<{ id: string; name: string }>;
};

export type AuthMe = {
  auth_mode: 'shared_anonymous';
  principal_id: string;
  principal_type: 'shared_anonymous' | 'oidc_federated';
  user: { name?: string; email?: string } | null;
  tenant: { id: string; name: string };
  shared_data: true;
  roles: string[];
  permissions: string[];
  session: { id: string; csrf_token: string; idle_expires_at: string; absolute_expires_at: string };
};

const authFetch = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const headers = new Headers(init?.headers);
  const csrf = authRuntime.getCsrfToken();
  if (csrf) headers.set('X-CSRF-Token', csrf);
  const response = await fetch(`/api/auth${path}`, { credentials: 'same-origin', ...init, headers });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`Auth request failed: HTTP ${response.status}`) as Error & { status: number; payload: unknown };
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload as T;
};

export const getAuthConfig = () => authFetch<AuthConfig>('/config');
export const getAuthMe = () => authFetch<AuthMe>('/me');
export const createAnonymousSession = (tenantId?: string) =>
  authFetch<AuthMe>(`/session/anonymous${tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : ''}`, { method: 'POST' });
export const switchTenant = (tenantId: string) =>
  authFetch<AuthMe>(`/session/switch-tenant?tenant_id=${encodeURIComponent(tenantId)}`, { method: 'POST' });
export const oidcLoginUrl = (returnTo: string) => `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`;
