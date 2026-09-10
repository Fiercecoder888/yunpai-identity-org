import type { AppPath } from '../../app/router';
import type { PermissionCode } from './permissionCatalog';

export type RoutePermissionDef = {
  permission: PermissionCode | null;
  auditModule: string;
};

export const routePermissions: Record<AppPath, RoutePermissionDef> = {
  '/leader': { permission: 'leader:read', auditModule: 'LeaderWorkbench' },
  '/worker': { permission: 'worker:read', auditModule: 'WorkerWorkbench' },
  '/org': { permission: 'org:write', auditModule: 'OrgStructure' },
  '/accounts': { permission: 'account:write', auditModule: 'Accounts' },
  '/roles': { permission: 'role:manage', auditModule: 'Roles' },
};
