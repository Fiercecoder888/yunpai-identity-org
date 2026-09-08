import { authRuntime } from './authRuntime';

/**
 * 鉴权契约（对接 PR #6 orchestrator 的账号密码登录，非旧 BFF 匿名会话）。
 *
 * - `/api/auth/config`：能力开关（账号密码模式：无匿名会话、无 OIDC）。
 * - `/api/auth/bootstrap-status`：系统是否已初始化（空库 → 前端跳厂长注册）。
 * - `/api/auth/register-admin`：厂长自助注册（全系统唯一一次，自动登录）。
 * - `/api/auth/login` / `logout` / `change-password` / `me`。
 */
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

/** `/api/auth/me` 与 `login` 的响应（PR #6 identity.resolve 结构）。 */
export type AuthMe = {
  tenant_id?: string;
  user_id?: string;
  display_name?: string | null;
  roles: string[];
  role_names?: string[];
  permissions: string[];
  /** 查看类权限的数据范围：{ 'order.view': 'self' }。 */
  permission_scopes?: Record<string, string>;
  org_id?: string | null;
  org_path?: string[];
  skill?: string | null;
  must_change_password?: boolean;
  principal?: { actor: string; tenant_id: string; roles: string[]; source?: string };
  // ---- 旧 BFF 契约的可选兼容字段（PR #6 的 /api/auth/me 不返回）----
  auth_mode?: 'shared_anonymous' | 'authenticated_isolated';
  principal_id?: string;
  principal_type?: 'shared_anonymous' | 'oidc_federated' | 'login';
  user?: { name?: string; email?: string } | null;
  tenant?: { id: string; name?: string };
  session?: {
    id: string;
    csrf_token?: string;
    idle_expires_at?: string;
    absolute_expires_at?: string;
  };
  shared_data?: boolean;
};

export type BootstrapStatus = {
  tenant_id: string;
  needs_bootstrap: boolean;
  user_count: number;
  company_name?: string | null;
};

export type RegisterAdminPayload = {
  company_name: string;
  user_id: string;
  password: string;
  display_name?: string;
  tenant_id?: string;
};

const authFetch = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const headers = new Headers(init?.headers);
  const csrf = authRuntime.getCsrfToken();
  if (csrf) headers.set('X-CSRF-Token', csrf);
  const response = await fetch(`/api/auth${path}`, {
    credentials: 'include',
    ...init,
    headers,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = (payload as { detail?: { code?: string; message?: string } } | null)?.detail;
    const error = new Error(detail?.message ?? `Auth request failed: HTTP ${response.status}`) as Error & {
      status: number;
      code?: string;
      payload: unknown;
    };
    error.status = response.status;
    error.code = detail?.code;
    error.payload = payload;
    throw error;
  }
  return payload as T;
};

const jsonPost = <T>(path: string, body: unknown): Promise<T> =>
  authFetch<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

export const getAuthConfig = () => authFetch<AuthConfig>('/config');
export const getAuthMe = () => authFetch<AuthMe>('/me');
export const getBootstrapStatus = () => authFetch<BootstrapStatus>('/bootstrap-status');

export const registerAdmin = (payload: RegisterAdminPayload) =>
  jsonPost<AuthMe>('/register-admin', payload);

export const loginUser = (userId: string, password: string) =>
  jsonPost<AuthMe>('/login', { user_id: userId, password });

export const logoutUser = () => jsonPost<{ ok: boolean }>('/logout', {});

export const changePassword = (oldPassword: string, newPassword: string) =>
  jsonPost<{ ok: boolean }>('/change-password', {
    old_password: oldPassword,
    new_password: newPassword,
  });

/** 兼容旧 BFF 契约（PR #6 的 config 里 anonymous_session=false，不会被调用）。 */
export const createAnonymousSession = (tenantId?: string) =>
  authFetch<AuthMe>(
    `/session/anonymous${tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : ''}`,
    { method: 'POST' },
  );

export const oidcLoginUrl = (returnTo: string) =>
  `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`;
