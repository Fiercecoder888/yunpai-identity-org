import type { PermissionCode } from './permissionCatalog';

/**
 * PR #6 后端角色 → 前端页面权限码。
 *
 * 两套 code 的语义不同：后端是「流程/Gate 权限」（`order.view`/`candidate.approve`…），
 * 前端是「页面/能力权限」（`m1:read`/`leader:write`…）。这里做**显式、可审计**的
 * 映射，而不是自动推导——页面可见性由产品定义，不应从流程权限里猜。
 *
 * 兜底原则：未知角色 → 空权限（fail-closed，页面全挡）；后端 `identity.admin`
 * 额外授予组织架构/账号/角色/引导四组页面权限（厂长通过 org-admin 角色获得）。
 */
const PAGE_PERMISSIONS_BY_ROLE: Record<string, PermissionCode[]> = {
  'factory-director': [
    'dashboard:read', 'leader:read', 'leader:write', 'worker:read', 'worker:report',
    'm1:read', 'm4:read', 'm4:operate', 'schedule:read', 'schedule:write',
    'qc:read', 'quality:supervise', 'audit:read', 'm0:bom:approve',
    'chat:read', 'chat:write', 'chat:delete',
  ],
  'quality-assurance': [
    'dashboard:read', 'm1:read', 'qc:read', 'quality:supervise', 'audit:read',
    'chat:read', 'chat:write',
  ],
  'team-leader': [
    'dashboard:read', 'leader:read', 'leader:write', 'worker:read',
    'schedule:read', 'audit:read', 'chat:read', 'chat:write',
  ],
  worker: ['worker:read', 'worker:report', 'chat:read', 'chat:write'],
  // 流程角色（非产品四角色）：只读最小集，避免越权看到管理页。
  'org-admin': ['chat:read', 'chat:write'],
  'data-steward': ['dashboard:read', 'm1:read', 'chat:read', 'chat:write'],
  engineer: ['dashboard:read', 'm1:read', 'chat:read', 'chat:write'],
  planner: ['dashboard:read', 'schedule:read', 'm4:read', 'chat:read', 'chat:write'],
  'release-manager': ['dashboard:read', 'schedule:read', 'chat:read', 'chat:write'],
};

/** `identity.admin`（组织架构与账号管理）→ 四组页面权限。 */
const IDENTITY_ADMIN_PERMISSIONS: PermissionCode[] = [
  'org:read', 'org:write', 'account:read', 'account:write', 'role:manage', 'system:setup',
];

export const pagePermissionsForRoles = (
  roles: readonly string[],
  backendPermissions: readonly string[] = [],
): PermissionCode[] => {
  const result = new Set<PermissionCode>();
  for (const role of roles) {
    for (const permission of PAGE_PERMISSIONS_BY_ROLE[role] ?? []) {
      result.add(permission);
    }
  }
  if (backendPermissions.includes('identity.admin')) {
    for (const permission of IDENTITY_ADMIN_PERMISSIONS) {
      result.add(permission);
    }
  }
  return [...result];
};

export const KNOWN_BACKEND_ROLES = Object.keys(PAGE_PERMISSIONS_BY_ROLE);
