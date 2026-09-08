import { create } from 'zustand';
import {
  changePassword as apiChangePassword,
  createAnonymousSession,
  getAuthConfig,
  getAuthMe,
  getBootstrapStatus,
  loginUser,
  logoutUser,
  registerAdmin as apiRegisterAdmin,
  type AuthConfig,
  type AuthMe,
  type RegisterAdminPayload,
} from './authApi';
import { authRuntime } from './authRuntime';

const DB_TENANT_KEY = 'yunpai.db-tenant';

/**
 * 鉴权状态（PR #6 账号密码模式）。
 *
 * 启动流程：`/api/auth/config` → `/api/auth/me`（401 = 未登录，不是错误）→
 * 未登录时再查 `/api/auth/bootstrap-status` 判断是「厂长注册」还是「登录」。
 * 匿名会话/OIDC 仅保留兼容分支（PR #6 的 config 里 capabilities 全 false）。
 */
type AuthState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  config?: AuthConfig;
  me?: AuthMe;
  /** 系统尚未初始化（空库）→ 只放「厂长注册」页。 */
  needsBootstrap: boolean;
  companyName?: string | null;
  error?: string;
  bootstrap: () => Promise<void>;
  refreshMe: () => Promise<AuthMe>;
  login: (userId: string, password: string) => Promise<AuthMe>;
  registerAdmin: (payload: RegisterAdminPayload) => Promise<AuthMe>;
  logout: () => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  /** 兼容旧契约：单租户模式下只刷新会话（无切换端点）。 */
  switchTenant: (tenantId: string) => Promise<void>;
  /** 兼容旧契约：匿名会话模式下重建会话（PR #6 返回 false）。 */
  recoverAnonymousSession: () => Promise<boolean>;
};

let recoveryPromise: Promise<boolean> | undefined;

const isUnauthorized = (error: unknown) => (error as { status?: number }).status === 401;

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'idle',
  needsBootstrap: false,

  bootstrap: async () => {
    set({ status: 'loading', error: undefined });
    try {
      const config = await getAuthConfig();
      let me: AuthMe | undefined;
      try {
        me = await getAuthMe();
      } catch (error) {
        // 401 = 尚未登录（正常状态），其它错误才算身份服务故障。
        if (!isUnauthorized(error)) throw error;
        // 兼容旧 BFF 匿名会话模式（PR #6 的 config 里 anonymous_session=false）。
        if (config.capabilities.anonymous_session) {
          await createAnonymousSession(localStorage.getItem(DB_TENANT_KEY) ?? undefined);
          me = await getAuthMe();
        }
      }
      let needsBootstrap = false;
      let companyName: string | null | undefined;
      if (!me) {
        const bootstrapStatus = await getBootstrapStatus();
        needsBootstrap = bootstrapStatus.needs_bootstrap;
        companyName = bootstrapStatus.company_name;
      }
      authRuntime.setCsrfToken(me?.session?.csrf_token);
      set({ status: 'ready', config, me, needsBootstrap, companyName, error: undefined });
    } catch (error) {
      authRuntime.setCsrfToken(undefined);
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Authentication unavailable',
      });
      throw error;
    }
  },

  refreshMe: async () => {
    const me = await getAuthMe();
    authRuntime.setCsrfToken(me.session?.csrf_token);
    set({ status: 'ready', me, needsBootstrap: false, error: undefined });
    return me;
  },

  login: async (userId: string, password: string) => {
    await loginUser(userId, password);
    return get().refreshMe();
  },

  registerAdmin: async (payload: RegisterAdminPayload) => {
    await apiRegisterAdmin(payload);
    return get().refreshMe();
  },

  logout: async () => {
    try {
      await logoutUser();
    } finally {
      authRuntime.setCsrfToken(undefined);
      set({ status: 'ready', me: undefined, needsBootstrap: false, error: undefined });
    }
  },

  changePassword: async (oldPassword: string, newPassword: string) => {
    await apiChangePassword(oldPassword, newPassword);
    await get().refreshMe();
  },

  switchTenant: async () => {
    // 单租户交付：无切换端点，仅刷新当前会话。
    await get().refreshMe();
  },

  recoverAnonymousSession: async () => {
    if (recoveryPromise) return recoveryPromise;
    recoveryPromise = (async () => {
      const config = get().config;
      if (!config?.capabilities.anonymous_session || config.auth_mode !== 'shared_anonymous') {
        return false;
      }
      try {
        // 另一个标签页可能已轮换共享会话 Cookie：先用当前 Cookie 读一次，
        // 401 才用（可能过期的）内存 CSRF 建新匿名会话。
        let me: AuthMe;
        try {
          me = await getAuthMe();
        } catch (error) {
          if ((error as { status?: number }).status !== 401) throw error;
          await createAnonymousSession(localStorage.getItem(DB_TENANT_KEY) ?? undefined);
          me = await getAuthMe();
        }
        authRuntime.setCsrfToken(me.session?.csrf_token);
        set({ status: 'ready', me, error: undefined });
        return true;
      } catch (error) {
        set({ status: 'error', error: error instanceof Error ? error.message : 'Session recovery failed' });
        return false;
      } finally {
        recoveryPromise = undefined;
      }
    })();
    return recoveryPromise;
  },
}));

authRuntime.setRecovery(() => useAuthStore.getState().recoverAnonymousSession());

export const bootstrapAuth = () => useAuthStore.getState().bootstrap();
