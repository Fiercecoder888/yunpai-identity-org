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

  it('keeps the full navigation for the factory director role with all permissions', () => {
    const groups = filterSidebarGroups(
      role('factory-director', [
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
      ]),
    );

    const keys = groups.flatMap((group) => group.items.map((item) => item.key));
    expect(keys).toContain('/dashboard');
    expect(keys).toContain('/quality');
    expect(keys).toContain('/modules/m0-review');
    expect(keys).toContain('/modules/purchase-warnings');
    expect(keys).toContain('/modules/legal-final-review');
    expect(keys).toContain('/modules/qc');
    expect(keys).toContain('/modules/data-construction');
    expect(keys).toContain('/audit');
    expect(keys).toContain('/modules/trace-workbench');
  });

  it('keeps the supervision view as a secondary entry for quality assurance', () => {
    const groups = filterSidebarGroups(role('quality-assurance', ['quality:supervise', 'qc:read', 'chat:read', 'chat:write']));
    const keys = groups.flatMap((group) => group.items.map((item) => item.key));

    expect(keys).toEqual(['/quality']);
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

    expect(keys).toContain('/leader');
    expect(keys).toContain('/worker');
    expect(keys).toContain('/modules/schedule');
    expect(keys).toContain('/modules/m5-flow');
    expect(keys).toContain('/audit');
    expect(keys).not.toContain('/dashboard');
    expect(keys).not.toContain('/modules/qc');
    expect(keys).not.toContain('/modules/data-construction');
    expect(keys).not.toContain('/modules/m0-wiki');
    expect(keys).not.toContain('/modules/trace-workbench');
  });
});
