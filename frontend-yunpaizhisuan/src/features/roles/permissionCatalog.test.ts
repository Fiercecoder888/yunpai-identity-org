import { describe, expect, it } from 'vitest';
import permissionFixture from '../../mocks/fixtures/permissions.json';
import { isPermissionCode, PERMISSION_CODES } from './permissionCatalog';

describe('permissionCatalog', () => {
  it('exposes a deduplicated permission code list', () => {
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length);
    expect(PERMISSION_CODES.length).toBeGreaterThanOrEqual(10);
  });

  it('guards every catalog code as a valid permission', () => {
    for (const code of PERMISSION_CODES) {
      expect(isPermissionCode(code)).toBe(true);
    }
  });

  it('rejects unknown or malformed values', () => {
    expect(isPermissionCode('root:admin')).toBe(false);
    expect(isPermissionCode('m1:read')).toBe(true);
    expect(isPermissionCode(undefined)).toBe(false);
    expect(isPermissionCode(null)).toBe(false);
    expect(isPermissionCode({})).toBe(false);
    expect(isPermissionCode(42)).toBe(false);
  });

  it('keeps the operator fixture permissions inside the catalog', () => {
    const catalog = PERMISSION_CODES as readonly string[];
    const operatorPermissions = [
      'dashboard:read',
      'm1:read',
      'm4:read',
      'm4:operate',
      'schedule:read',
      'schedule:write',
      'audit:read',
    ];
    for (const code of operatorPermissions) {
      expect(catalog).toContain(code);
    }
  });

  it('grants the factory director every catalog permission', () => {
    const director = permissionFixture.roles.find((role) => role.id === 'factory-director');

    expect(director).toBeDefined();
    expect(new Set(director?.permissions)).toEqual(new Set(PERMISSION_CODES));
  });
});
