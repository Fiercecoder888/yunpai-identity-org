import { isDemoRoleEnabled, isLenovoTestIdentity } from '../app/runtimeMode';
import { PERMISSION_CODES, isPermissionCode, type PermissionCode } from '../features/roles/permissionCatalog';
import { pagePermissionsForRoles } from '../features/roles/backendPermissionMap';
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

  // PR #6 真鉴权：角色/权限来自 /api/auth/me（useAuthStore 启动时已拉取）。
  // 后端是流程权限 code（order.view…），前端是页面权限 code（m1:read…），
  // 由 backendPermissionMap 显式映射；未知角色 → 空权限（fail-closed）。
  const me = useAuthStore.getState().me;
  if (me) {
    // 旧 BFF 匿名会话的共享开发者仍映射到厂长视图（兼容分支，PR #6 不产生）。
    const isSharedDeveloper =
      me.principal_type === 'shared_anonymous' && me.roles?.includes('shared_developer');
    if (isSharedDeveloper) {
      return {
        id: 'factory-director',
        name: me.user?.name ?? '共享开发者',
        permissions: me.permissions.filter(isPermissionCode),
      };
    }
    return {
      id: me.roles[0] ?? 'unbound',
      name: me.role_names?.[0] ?? me.display_name ?? me.roles[0] ?? '未绑定角色',
      // 角色映射（PR #6 后端码 → 页面码）与直通（旧契约/测试夹具里的页面码）取并集：
      // 后端码不是页面码，会被 isPermissionCode 过滤掉；页面码直接保留。
      permissions: [
        ...new Set([
          ...pagePermissionsForRoles(me.roles, me.permissions),
          ...me.permissions.filter(isPermissionCode),
        ]),
      ],
    };
  }
  const payload = await requestJson<unknown>('/auth/me');
  return normalizeRole(payload);
}

export function hasPermission(role: RolePermission | null | undefined, permission: PermissionCode) {
  return Boolean(role?.permissions.includes(permission));
}
