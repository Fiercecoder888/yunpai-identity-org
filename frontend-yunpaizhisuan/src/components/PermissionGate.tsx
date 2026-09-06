import { Alert, Space, Spin } from 'antd';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useCurrentRole } from '../features/roles/useCurrentRole';
import { AUDIT_LOG_SYNC_FAILURE_MESSAGE, createAuditLog, writeAuditLogSafely } from '../services/auditLogger';
import { hasPermission, type PermissionCode } from '../services/permissionApi';

type PermissionGateProps = {
  permission: PermissionCode;
  auditModule: string;
  targetId: string;
  children: ReactNode;
  fallback?: ReactNode;
};

export function PermissionGate({ permission, auditModule, targetId, children, fallback }: PermissionGateProps) {
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  const checkingPermission = roleQuery.isPending || roleQuery.isFetching;
  const allowed = !roleQuery.permissionUnavailable && hasPermission(role, permission);
  const [auditWarning, setAuditWarning] = useState(false);
  const auditKey = `${roleQuery.permissionContextKey}|${permission}|${auditModule}|${targetId}`;
  const loggedAuditKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setAuditWarning(false);
  }, [auditKey]);

  useEffect(() => {
    if (checkingPermission || allowed || loggedAuditKeyRef.current === auditKey) {
      return;
    }

    loggedAuditKeyRef.current = auditKey;
    void writeAuditLogSafely(
      createAuditLog({
        actor: roleQuery.permissionError ? '权限服务未就绪' : (role?.name ?? '权限服务未就绪'),
        action: 'PERMISSION_DENIED',
        module: auditModule,
        targetId,
        result: 'blocked',
        detail: roleQuery.permissionError ? `访问${auditModule}失败：权限后端未就绪` : `访问${auditModule}操作权限不足`,
      }),
    ).then((result) => {
      setAuditWarning(!result.ok);
    });
  }, [allowed, auditKey, auditModule, checkingPermission, role?.name, roleQuery.permissionError, targetId]);

  if (checkingPermission) {
    return (
      <Space direction="vertical" size={12} className="page-stack">
        <Spin />
      </Space>
    );
  }

  if (allowed) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return (
    <Space direction="vertical" size={12} className="page-stack">
      <Alert
        type="error"
        showIcon
        message={roleQuery.permissionError ? '权限后端未就绪' : '无权限访问'}
        description={roleQuery.permissionError ? '真实模式下无法获取当前用户权限，已按 fail closed 处理。' : `缺少权限：${permission}`}
      />
      {auditWarning ? <Alert type="warning" showIcon message={AUDIT_LOG_SYNC_FAILURE_MESSAGE} description="权限拒绝记录暂未同步。" /> : null}
    </Space>
  );
}
