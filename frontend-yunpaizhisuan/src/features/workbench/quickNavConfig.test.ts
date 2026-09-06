import { describe, expect, it } from 'vitest';
import type { PermissionCode } from '../../services/permissionApi';
import {
  filterQuickNavItems,
  findRoleQuickNav,
  quickNavRoleIds,
  roleQuickNavs,
  type QuickNavItem,
} from './quickNavConfig';

const item = (overrides: Partial<QuickNavItem>): QuickNavItem => ({
  key: 'nav',
  title: '导航',
  description: '描述',
  path: '/dashboard',
  icon: () => null,
  ...overrides,
});

describe('quickNavConfig', () => {
  it('defines quick nav grids for exactly the four roles', () => {
    expect(roleQuickNavs).toHaveLength(4);
    expect(quickNavRoleIds).toEqual(['factory-director', 'quality-assurance', 'team-leader', 'worker']);
  });

  it('gives every role a distinct set of nav items', () => {
    for (const nav of roleQuickNavs) {
      expect(nav.items.length).toBeGreaterThanOrEqual(nav.roleId === 'quality-assurance' ? 1 : 3);
      const keys = nav.items.map((entry) => entry.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys.every((key) => key.trim().length > 0)).toBe(true);
    }
  });

  it('finds the quick nav grid for a role id', () => {
    expect(findRoleQuickNav('factory-director')?.roleName).toBe('厂长');
    expect(findRoleQuickNav('quality-assurance')?.roleName).toBe('品保');
    expect(findRoleQuickNav('team-leader')?.roleName).toBe('组长');
    expect(findRoleQuickNav('worker')?.roleName).toBe('生产工人');
    expect(findRoleQuickNav('unknown-role')).toBeUndefined();
  });

  it('filters nav items by the current role permissions', () => {
    const items = [
      item({ key: 'dashboard', permission: 'dashboard:read' }),
      item({ key: 'audit', permission: 'audit:read' }),
      item({ key: 'open', permission: undefined }),
    ];

    expect(filterQuickNavItems(items, ['dashboard:read']).map((entry) => entry.key)).toEqual(['dashboard', 'open']);
    expect(filterQuickNavItems(items, undefined).map((entry) => entry.key)).toEqual(['dashboard', 'audit', 'open']);
    expect(filterQuickNavItems(items, []).map((entry) => entry.key)).toEqual(['open']);
  });

  it('keeps permission-gated items only for roles that hold the permission', () => {
    const leader = roleQuickNavs.find((nav) => nav.roleId === 'team-leader');
    const leaderPermissions: PermissionCode[] = ['leader:read', 'schedule:read', 'worker:read'];
    const visible = filterQuickNavItems(leader?.items ?? [], leaderPermissions);
    expect(visible.some((entry) => entry.key === 'leader')).toBe(true);
    expect(visible.some((entry) => entry.key === 'm5-flow')).toBe(true);
    expect(visible.every((entry) => entry.permission == null || leaderPermissions.includes(entry.permission))).toBe(true);
  });
});
