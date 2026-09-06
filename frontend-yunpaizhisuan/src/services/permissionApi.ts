import { isDemoRoleEnabled, isLenovoTestIdentity } from '../app/runtimeMode';
import { PERMISSION_CODES, isPermissionCode, type PermissionCode } from '../features/roles/permissionCatalog';
import { requestJson } from './httpClient';
import { useAuthStore } from '../auth/useAuthStore';

export type { PermissionCode } from '../features/roles/permissionCatalog';

export type RolePermission = {
  id: string;
  name: string;
  permissions: PermissionCode[];
};

const lenovoTestPermissions: PermissionCode[] = [...PERMISSION_CODES];

type PermissionFixture = {
  currentRoleId: string;
  permissionDeniedRoleId: string;
  roles: RolePermission[];
};

type AuthMeResponse = {
  id?: string;
  role_id?: string;
  roleId?: string;
  name?: string;
  role_name?: string;
  roleName?: string;
  permissions?: PermissionCode[];
  role?: Partial<RolePermission>;
  data?: unknown;
};

export const currentRoleQueryKey = ['permissions', 'current-role'] as const;

const normalizeRole = (payload: unknown): RolePermission => {
  const record = payload as AuthMeResponse;
  const nested = (record.data as AuthMeResponse | undefined)?.role ?? (record.data as AuthMeResponse | undefined) ?? record.role ?? record;
  const role = nested as AuthMeResponse;
  const permissions = Array.isArray(role.permissions) ? role.permissions.filter(isPermissionCode) : [];
  const id = role.id ?? role.role_id ?? role.roleId;
  const name = role.name ?? role.role_name ?? role.roleName;

  if (!id || !name || permissions.length === 0) {
    throw new Error('Permission response is missing role id, name, or permissions');
  }

  return { id, name, permissions };
};

const findRole = (fixture: PermissionFixture, roleId: string) =>
  fixture.roles.find((role) => role.id === roleId) ?? fixture.roles.find((role) => role.id === fixture.currentRoleId) ?? fixture.roles[0];

export async function listDemoRoles(): Promise<RolePermission[]> {
  if (!isDemoRoleEnabled()) {
    return [];
  }
  const { default: permissionFixture } = await import('../mocks/fixtures/permissions.json');
  return (permissionFixture as PermissionFixture).roles;
}

const getDemoRole = async () => {
  const [{ default: permissionFixture }, { getMockScenario }] = await Promise.all([
    import('../mocks/fixtures/permissions.json'),
    import('../mocks/scenarios/current'),
  ]);
  const fixture = permissionFixture as PermissionFixture;

  if (getMockScenario() === 'permissionDenied') {
    return findRole(fixture, fixture.permissionDeniedRoleId);
  }

  if (typeof window !== 'undefined') {
    const roleId = window.localStorage.getItem('mockRoleId');
    if (roleId) {
      return findRole(fixture, roleId);
    }
  }

  return findRole(fixture, fixture.currentRoleId);
};

export async function getCurrentRole() {
  if (isDemoRoleEnabled()) {
    return getDemoRole();
  }

  if (isLenovoTestIdentity()) {
    return {
      id: 'lenovo-test-operator',
      name: 'Lenovo 联调操作员',
      permissions: lenovoTestPermissions,
    };
  }

  const me = useAuthStore.getState().me;
  if (me) {
    const isSharedDeveloper =
      me.principal_type === 'shared_anonymous' && me.roles?.includes('shared_developer');
    return {
      id: isSharedDeveloper ? 'factory-director' : (me.roles[0] ?? 'shared-developer'),
      name: me.user?.name ?? '共享开发者',
      permissions: me.permissions.filter(isPermissionCode),
    };
  }
  const payload = await requestJson<unknown>('/auth/me');
  return normalizeRole(payload);
}

export function hasPermission(role: RolePermission | null | undefined, permission: PermissionCode) {
  return Boolean(role?.permissions.includes(permission));
}
