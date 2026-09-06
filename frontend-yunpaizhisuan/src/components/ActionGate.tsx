import { Tooltip } from 'antd';
import { Children, cloneElement, useRef, type MouseEvent, type ReactElement } from 'react';
import { useCurrentRole } from '../features/roles/useCurrentRole';
import { createAuditLog, writeAuditLogSafely } from '../services/auditLogger';
import { hasPermission, type PermissionCode } from '../services/permissionApi';

type ActionGateChildProps = {
  disabled?: boolean;
  onClick?: (event: MouseEvent) => void;
};

type ActionGateProps = {
  permission: PermissionCode;
  auditModule: string;
  targetId: string;
  children: ReactElement;
  deniedTitle?: string;
};

export function ActionGate({ permission, auditModule, targetId, children, deniedTitle }: ActionGateProps) {
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  const ready = !roleQuery.permissionUnavailable;
  const allowed = ready && hasPermission(role, permission);
  const auditKey = `${roleQuery.permissionContextKey}|${permission}|${auditModule}|${targetId}`;
  const loggedAuditKeyRef = useRef<string | null>(null);

  const interceptClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!ready || loggedAuditKeyRef.current === auditKey) {
      return;
    }
    loggedAuditKeyRef.current = auditKey;
    void writeAuditLogSafely(
      createAuditLog({
        actor: role?.name ?? '权限服务未就绪',
        action: 'PERMISSION_DENIED',
        module: auditModule,
        targetId,
        result: 'blocked',
        detail: `拒绝操作：缺少权限 ${permission}`,
      }),
    );
  };

  if (allowed) {
    return <>{children}</>;
  }

  return (
    <Tooltip title={deniedTitle ?? (roleQuery.permissionError ? '权限后端未就绪' : `缺少权限：${permission}`)}>
      <span className="action-gate" data-testid="action-gate-blocked" onClick={interceptClick} onPointerDown={interceptClick}>
        {cloneElement(Children.only(children) as ReactElement<ActionGateChildProps>, {
          disabled: true,
          onClick: interceptClick,
        })}
      </span>
    </Tooltip>
  );
}
