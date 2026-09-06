import { Alert, Button, Modal } from 'antd';
import { useState } from 'react';
import { useAuthStore } from '../../auth/useAuthStore';
import { extendSession, formatRemaining, useSessionTimer } from './useSessionTimer';

export function SessionExpiryNotice() {
  const status = useAuthStore((state) => state.status);
  const me = useAuthStore((state) => state.me);
  const config = useAuthStore((state) => state.config);
  const session = me?.session;
  const { phase, idleRemainingMs } = useSessionTimer(session);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [extendFailed, setExtendFailed] = useState(false);

  if (status !== 'ready' || !session) return null;
  if (phase === 'active') return null;

  const isOidc = me?.principal_type === 'oidc_federated' || config?.capabilities.oidc_login;

  const handleExtend = async () => {
    setBusy(true);
    setExtendFailed(false);
    const result = await extendSession();
    if (result.outcome === 'relogin') {
      window.location.assign(result.url);
      return;
    }
    if (result.outcome === 'unavailable') {
      setExtendFailed(true);
    }
    setBusy(false);
  };

  const action = (
    <Button size="small" loading={busy} onClick={() => void handleExtend()}>
      {isOidc ? '去登录' : '续期/刷新'}
    </Button>
  );

  if (phase === 'warning') {
    if (dismissed) return null;
    return (
      <Alert
        className="session-expiry-warning"
        type="warning"
        showIcon
        banner
        closable
        message="会话即将过期"
        description={`闲置会话将在 ${formatRemaining(idleRemainingMs)} 后过期，请点击续期或刷新。`}
        action={action}
        onClose={() => setDismissed(true)}
      />
    );
  }

  return (
    <Modal
      open
      title="会话已过期"
      footer={null}
      closable={false}
      maskClosable={false}
    >
      <p>会话已过期，请重新登录或刷新页面。</p>
      {extendFailed ? <p role="alert">会话续期失败，请刷新页面重试。</p> : null}
      {action}
    </Modal>
  );
}
