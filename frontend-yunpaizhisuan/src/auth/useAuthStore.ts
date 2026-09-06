import { create } from 'zustand';
import {
  createAnonymousSession,
  getAuthConfig,
  getAuthMe,
  switchTenant as apiSwitchTenant,
  type AuthConfig,
  type AuthMe,
} from './authApi';
import { authRuntime } from './authRuntime';

const DB_TENANT_KEY = 'yunpai.db-tenant';

type AuthState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  config?: AuthConfig;
  me?: AuthMe;
  error?: string;
  bootstrap: () => Promise<void>;
  recoverAnonymousSession: () => Promise<boolean>;
  switchTenant: (tenantId: string) => Promise<void>;
};

let recoveryPromise: Promise<boolean> | undefined;

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'idle',
  bootstrap: async () => {
    set({ status: 'loading', error: undefined });
    try {
      const config = await getAuthConfig();
      let me: AuthMe;
      try {
        me = await getAuthMe();
      } catch (error) {
        if ((error as { status?: number }).status !== 401 || !config.capabilities.anonymous_session) {
          throw error;
        }
        // 优先用上次选择的数据库版本（测试库/生产库）建会话
        const savedTenant = localStorage.getItem(DB_TENANT_KEY) ?? undefined;
        await createAnonymousSession(savedTenant);
        me = await getAuthMe();
      }
      authRuntime.setCsrfToken(me.session.csrf_token);
      set({ status: 'ready', config, me });
    } catch (error) {
      authRuntime.setCsrfToken(undefined);
      set({ status: 'error', error: error instanceof Error ? error.message : 'Authentication unavailable' });
      throw error;
    }
  },
  switchTenant: async (tenantId: string) => {
    const me = await apiSwitchTenant(tenantId);
    authRuntime.setCsrfToken(me.session.csrf_token);
    localStorage.setItem(DB_TENANT_KEY, tenantId);
    set({ status: 'ready', me });
  },
  recoverAnonymousSession: async () => {
    if (recoveryPromise) return recoveryPromise;
    recoveryPromise = (async () => {
      const config = get().config;
      if (!config?.capabilities.anonymous_session || config.auth_mode !== 'shared_anonymous') return false;
      try {
        // Another tab may already have rotated the shared session cookie. Read
        // that cookie's current CSRF token before attempting a state-changing
        // anonymous-session creation with our stale in-memory token.
        let me: AuthMe;
        try {
          me = await getAuthMe();
        } catch (error) {
          if ((error as { status?: number }).status !== 401) throw error;
          await createAnonymousSession(localStorage.getItem(DB_TENANT_KEY) ?? undefined);
          me = await getAuthMe();
        }
        authRuntime.setCsrfToken(me.session.csrf_token);
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
