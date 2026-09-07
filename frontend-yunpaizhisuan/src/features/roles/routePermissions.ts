import type { AppPath } from '../../app/router';
import type { PermissionCode } from './permissionCatalog';

export type RoutePermissionDef = {
  permission: PermissionCode | null;
  auditModule: string;
};

export const routePermissions: Record<AppPath, RoutePermissionDef> = {
  '/quality': { permission: 'quality:supervise', auditModule: 'QualitySupervision' },
  '/dashboard': { permission: 'dashboard:read', auditModule: 'Dashboard' },
  '/cockpit': { permission: 'dashboard:read', auditModule: 'Cockpit' },
  '/tasks': { permission: null, auditModule: 'TaskBoard' },
  '/leader': { permission: 'leader:read', auditModule: 'LeaderWorkbench' },
  '/worker': { permission: 'worker:read', auditModule: 'WorkerWorkbench' },
  '/modules/m0-review': { permission: 'm1:read', auditModule: 'M1' },
  '/modules/m3-procurement': { permission: 'm4:read', auditModule: 'M4' },
  '/modules/bom-review': { permission: 'm1:read', auditModule: 'M2' },
  '/modules/sop': { permission: 'm1:read', auditModule: 'M2' },
  '/modules/purchase-warnings': { permission: 'm4:read', auditModule: 'M4' },
  '/modules/m5-flow': { permission: 'schedule:read', auditModule: 'M5' },
  '/modules/qc': { permission: null, auditModule: 'QC' },
  '/modules/trace-workbench': { permission: 'dashboard:read', auditModule: 'BusinessTrace' },
  '/modules/finished-goods': { permission: 'dashboard:read', auditModule: 'BusinessTrace' },
  '/modules/warehouse-reconcile': { permission: 'dashboard:read', auditModule: 'WarehouseReconcile' },
  '/modules/schedule': { permission: 'schedule:read', auditModule: 'M5' },
  '/modules/sample-work-orders': { permission: 'schedule:read', auditModule: 'SampleWorkOrders' },
  '/modules/legal-final-review': { permission: null, auditModule: 'Legal' },
  '/modules/data-construction': { permission: null, auditModule: 'M0' },
  '/modules/m0-wiki': { permission: null, auditModule: 'M0' },
  '/audit': { permission: 'audit:read', auditModule: 'Audit' },
};
