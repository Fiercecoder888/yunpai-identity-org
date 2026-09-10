import { Alert, Button, Spin } from 'antd';
import type { ReactNode } from 'react';
import { useAuthStore } from './useAuthStore';
import { isDemoRoleEnabled } from '../app/runtimeMode';
import { SessionExpiryNotice } from '../features/session/SessionExpiryNotice';
import { OrgGuideGate } from '../features/org/OrgRecommendationModal';
import { ChangePasswordPage } from '../pages/ChangePasswordPage';
import { LoginPage } from '../pages/LoginPage';
import { RegisterAdminPage } from '../pages/RegisterAdminPage';

/**
 * 鉴权边界（PR #6 账号密码模式）。
 *
 * 渲染顺序：加载中 → 身份服务故障 → 未登录（空库给厂长注册页，否则登录页）
 * → 需改密（首登强制）→ 放行主应用。
 *
 * 演示/本地兜底：`VITE_ENABLE_DEMO_ROLES=true`（含 MSW demo）时跳过鉴权，
 * 用前端 mock 角色跑界面；交付与真实联调必须关掉它。
 */
export function AuthBoundary({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status);
  const error = useAuthStore((state) => state.error);
  const bootstrap = useAuthStore((state) => state.bootstrap);
  const me = useAuthStore((state) => state.me);
  const needsBootstrap = useAuthStore((state) => state.needsBootstrap);

  if (isDemoRoleEnabled()) return <>{children}</>;

  if (status === 'loading' || status === 'idle') {
    return <div className="auth-state"><Spin size="large" /></div>;
  }
  if (status === 'error') {
    return (
      <div className="auth-state">
        <Alert
          type="error"
          showIcon
          message="身份服务不可用"
          description={error}
          action={<Button onClick={() => void bootstrap()}>重试</Button>}
        />
      </div>
    );
  }
  if (!me) {
    return needsBootstrap ? <RegisterAdminPage /> : <LoginPage />;
  }
  if (me.must_change_password) {
    return <ChangePasswordPage forced />;
  }
  return (
    <>
      <SessionExpiryNotice />
      <OrgGuideGate />
      {children}
    </>
  );
}
