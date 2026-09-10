import { describe, expect, it } from 'vitest';
import type { RolePermission } from '../../services/permissionApi';
import { filterSidebarGroups, sidebarGroups } from './sidebarConfig';

const role = (id: string, permissions: RolePermission['permissions']): RolePermission => ({
  id,
  name: id,
  permissions,
});

describe('sidebarConfig', () => {
  it('shows every group when the role is not yet loaded', () => {
    expect(filterSidebarGroups(undefined).map((group) => group.key)).toEqual(sidebarGroups.map((group) => group.key));
  });

  it('keeps the surviving navigation for the factory director role with all permissions', () => {
    const groups = filterSidebarGroups(
      role('factory-director', [
        'leader:read',
        'leader:write',
        'worker:read',
        'worker:report',
        'quality:supervise',
        'chat:read',
        'chat:write',
        'chat:delete',
        'org:read',
        'org:write',
        'account:read',
        'account:write',
        'role:manage',
      ]),
    );

    const keys = groups.flatMap((group) => group.items.map((item) => item.key));
    expect(keys).toEqual(['/leader', '/worker', '/quality', '/org', '/accounts', '/roles']);
  });

  it('leaves only the quality workbench entry for the quality assurance role', () => {
    const groups = filterSidebarGroups(role('quality-assurance', ['quality:supervise', 'qc:read', 'chat:read', 'chat:write']));
    const keys = groups.flatMap((group) => group.items.map((item) => item.key));

    // 品保只有自己的落地页；既看不到管理页，也看不到组长/工人工作台
    expect(keys).toEqual(['/quality']);
    expect(keys).not.toContain('/org');
    expect(keys).not.toContain('/accounts');
    expect(keys).not.toContain('/roles');
    expect(keys).not.toContain('/leader');
    expect(keys).not.toContain('/worker');
  });

  it('narrows the sidebar for the worker role to workbench only', () => {
    const groups = filterSidebarGroups(role('worker', ['worker:read', 'worker:report', 'chat:read', 'chat:write']));
    const keys = groups.flatMap((group) => group.items.map((item) => item.key));

    expect(keys).toEqual(['/worker']);
  });

  it('keeps the leader scope for the team-leader role', () => {
    const groups = filterSidebarGroups(
      role('team-leader', ['leader:read', 'leader:write', 'worker:read', 'schedule:read', 'audit:read', 'chat:read', 'chat:write']),
    );
    const keys = groups.flatMap((group) => group.items.map((item) => item.key));

    expect(keys).toEqual(['/leader', '/worker']);
    expect(keys).not.toContain('/org');
    expect(keys).not.toContain('/accounts');
    expect(keys).not.toContain('/roles');
  });
});
