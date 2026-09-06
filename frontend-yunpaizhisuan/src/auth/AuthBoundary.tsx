import { Alert, Button, Spin } from 'antd';
import type { ReactNode } from 'react';
import { useAuthStore } from './useAuthStore';
import { isMswDemoMode } from '../app/runtimeMode';
import { SessionExpiryNotice } from '../features/session/SessionExpiryNotice';

export function AuthBoundary({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status);
  const error = useAuthStore((state) => state.error);
  const bootstrap = useAuthStore((state) => state.bootstrap);
  if (isMswDemoMode() || import.meta.env.VITE_LOCAL_LANGGRAPH === 'true') return <>{children}</>;

  if (status === 'loading' || status === 'idle') {
    return <div className="auth-state"><Spin size="large" /></div>;
  }
  if (status === 'error') {
    return <div className="auth-state"><Alert type="error" showIcon message="身份服务不可用" description={error} action={<Button onClick={() => void bootstrap()}>重试</Button>} /></div>;
  }
  return (
    <>
      <SessionExpiryNotice />
      {children}
    </>
  );
}
