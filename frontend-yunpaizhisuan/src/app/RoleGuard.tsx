import { Spin } from 'antd';
import { useEffect, useRef, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import type { AppPath } from './router';
import { routePermissions } from '../features/roles/routePermissions';
import { useCurrentRole } from '../features/roles/useCurrentRole';
import { hasPermission } from '../services/permissionApi';
import { createAuditLog, writeAuditLogSafely } from '../services/auditLogger';

export function RoleGuard({ path, children }: { path: AppPath; children: ReactNode }) {
  const roleQuery = useCurrentRole();
  const route = routePermissions[path];
  const role = roleQuery.data;
  const allowed = route.permission == null || hasPermission(role, route.permission);
  const loggedRef = useRef(false);

  useEffect(() => {
    if (roleQuery.isLoading || roleQuery.isFetching || allowed || loggedRef.current) {
      return;
    }
    loggedRef.current = true;
    void writeAuditLogSafely(
      createAuditLog({
        actor: role?.name ?? '权限服务未就绪',
        action: 'PERMISSION_DENIED',
        module: route.auditModule,
        targetId: path,
        result: 'blocked',
        detail: roleQuery.error
          ? `访问${route.auditModule}失败：权限后端未就绪`
          : `访问${route.auditModule}无权限：缺少 ${route.permission ?? '权限'}`,
      }),
    );
  }, [allowed, path, role?.name, roleQuery.error, roleQuery.isLoading, roleQuery.isFetching, route]);

  if (roleQuery.isLoading || roleQuery.isFetching) {
    // 角色切换后 useCurrentRole 后台刷新期间（isFetching）也保持等待，
    // 避免用旧角色对目标路由误判权限并 redirect（如切到工人时 /worker
    // 被旧角色判无权限而拉回 /home）。刷新完成后再按新角色放行。
    return (
      <div className="route-loading" data-testid="role-guard-loading">
        <Spin size="small" /> 权限校验中…
      </div>
    );
  }

  if (allowed) {
    return <>{children}</>;
  }

  return <Navigate to="/home" replace />;
}
