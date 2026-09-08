export const PERMISSION_CODES = [
  'dashboard:read',
  'leader:read',
  'leader:write',
  'worker:read',
  'worker:report',
  'm1:read',
  'm4:read',
  'm4:operate',
  'schedule:read',
  'schedule:write',
  'qc:read',
  'quality:supervise',
  'audit:read',
  'chat:read',
  'chat:write',
  'chat:delete',
  'm0:bom:approve',
  // 组织架构与账号（对应 PR #6 的 identity.admin；仅厂长/组织管理员）
  'org:read',
  'org:write',
  'account:read',
  'account:write',
  'role:manage',
  'system:setup',
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

export const isPermissionCode = (value: unknown): value is PermissionCode =>
  typeof value === 'string' && (PERMISSION_CODES as readonly string[]).includes(value);
