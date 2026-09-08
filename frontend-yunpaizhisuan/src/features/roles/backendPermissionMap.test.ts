import { describe, expect, it } from 'vitest';
import { KNOWN_BACKEND_ROLES, pagePermissionsForRoles } from './backendPermissionMap';
import { isPermissionCode } from './permissionCatalog';

describe('backendPermissionMap', () => {
  it('maps the four product roles to their page permissions', () => {
    expect(pagePermissionsForRoles(['factory-director'])).toContain('m4:operate');
    expect(pagePermissionsForRoles(['quality-assurance'])).toEqual(
      expect.arrayContaining(['quality:supervise', 'qc:read', 'audit:read', 'dashboard:read']),
    );
    expect(pagePermissionsForRoles(['team-leader'])).toEqual(
      expect.arrayContaining(['leader:read', 'leader:write', 'worker:read', 'schedule:read']),
    );
    expect(pagePermissionsForRoles(['worker'])).toEqual(
      expect.arrayContaining(['worker:read', 'worker:report']),
    );
    // 工人不得看到管理页
    expect(pagePermissionsForRoles(['worker'])).not.toContain('m1:read');
    expect(pagePermissionsForRoles(['worker'])).not.toContain('schedule:read');
  });

  it('grants the identity admin pages only when the backend grants identity.admin', () => {
    const withoutAdmin = pagePermissionsForRoles(['factory-director'], ['order.view']);
    expect(withoutAdmin).not.toContain('org:write');
    expect(withoutAdmin).not.toContain('account:write');

    const withAdmin = pagePermissionsForRoles(['factory-director', 'org-admin'], ['identity.admin']);
    expect(withAdmin).toEqual(
      expect.arrayContaining(['org:write', 'account:write', 'role:manage', 'system:setup']),
    );
  });

  it('fails closed for unknown roles', () => {
    expect(pagePermissionsForRoles(['ghost-role'])).toEqual([]);
    expect(pagePermissionsForRoles([])).toEqual([]);
  });

  it('only ever returns catalog permission codes', () => {
    for (const role of KNOWN_BACKEND_ROLES) {
      for (const code of pagePermissionsForRoles([role])) {
        expect(isPermissionCode(code), `${role} -> ${code}`).toBe(true);
      }
    }
  });
});
