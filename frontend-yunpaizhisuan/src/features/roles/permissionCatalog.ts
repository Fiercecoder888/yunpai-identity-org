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
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

export const isPermissionCode = (value: unknown): value is PermissionCode =>
  typeof value === 'string' && (PERMISSION_CODES as readonly string[]).includes(value);
