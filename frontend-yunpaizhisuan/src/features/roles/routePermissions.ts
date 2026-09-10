import type { AppPath } from '../../app/router';
import type { PermissionCode } from './permissionCatalog';

export type RoutePermissionDef = {
  permission: PermissionCode | null;
  auditModule: string;
};

export const routePermissions: Record<AppPath, RoutePermissionDef> = {
  '/leader': { permission: 'leader:read', auditModule: 'LeaderWorkbench' },
  '/worker': { permission: 'worker:read', auditModule: 'WorkerWorkbench' },
  // 品保工作台：可看 M7 来料待验/放行；**看不到 M1–M5 主链进度**（由页面内容保证，不靠权限）。
  '/quality': { permission: 'quality:supervise', auditModule: 'QualityWorkbench' },
  '/org': { permission: 'org:write', auditModule: 'OrgStructure' },
  '/accounts': { permission: 'account:write', auditModule: 'Accounts' },
  '/roles': { permission: 'role:manage', auditModule: 'Roles' },
};
