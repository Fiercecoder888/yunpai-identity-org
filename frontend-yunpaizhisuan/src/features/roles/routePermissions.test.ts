import { describe, expect, it } from 'vitest';
import { routeMeta } from '../../app/router';
import { isPermissionCode } from './permissionCatalog';
import { routePermissions } from './routePermissions';
import { sidebarGroups } from './sidebarConfig';

describe('routePermissions', () => {
  it('covers every AppPath route exactly once', () => {
    expect(Object.keys(routePermissions).sort()).toEqual(Object.keys(routeMeta).sort());
    expect(new Set(Object.keys(routePermissions)).size).toBe(Object.keys(routePermissions).length);
  });

  it('matches sidebarConfig permission requirements without drift', () => {
    for (const group of sidebarGroups) {
      for (const item of group.items) {
        const route = routePermissions[item.key];
        expect(route, `routePermissions is missing sidebar path ${item.key}`).toBeDefined();
        expect(route.permission, `permission drift on ${item.key}`).toBe(item.requiredPermission);
      }
    }
  });

  it('does not open a permission-scoped route beyond the sidebar contract', () => {
    const sidebarItems = sidebarGroups.flatMap((group) => group.items);
    for (const [path, route] of Object.entries(routePermissions)) {
      if (route.permission == null) {
        continue;
      }
      const sidebarItem = sidebarItems.find((item) => item.key === path);
      expect(sidebarItem, `route ${path} requires ${route.permission} but has no sidebar entry`).toBeDefined();
      expect(sidebarItem?.requiredPermission).toBe(route.permission);
    }
  });

  it('keeps every permission code inside the catalog', () => {
    for (const route of Object.values(routePermissions)) {
      if (route.permission != null) {
        expect(isPermissionCode(route.permission)).toBe(true);
      }
    }
  });

  it('records a stable audit module for every route', () => {
    for (const route of Object.values(routePermissions)) {
      expect(route.auditModule.length, `missing audit module for ${JSON.stringify(route)}`).toBeGreaterThan(0);
    }
  });
});
