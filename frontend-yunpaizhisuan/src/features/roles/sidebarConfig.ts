import type { AppPath } from '../../app/router';
import type { PermissionCode, RolePermission } from '../../services/permissionApi';
import { hasPermission } from '../../services/permissionApi';

export type SidebarNavItemDef = {
  key: AppPath;
  label: string;
  requiredPermission: PermissionCode | null;
  /** 可选角色白名单：为空表示所有角色可见（仍需通过权限检查）。 */
  roles?: string[];
  legal?: boolean;
};

export type SidebarGroupDef = {
  key: string;
  title: string;
  items: SidebarNavItemDef[];
};

/**
 * 侧栏分组仅用于面包屑分组标题（WorkbenchLayout）与权限/路由一致性校验。
 * 左侧深色导航栏已删除；业务模块页（Dashboard/驾驶舱/各 /modules/*）已随废稿清理下线，
 * 这里只保留仍在服务的工作台与身份/组织/账号入口。
 */
export const sidebarGroups: SidebarGroupDef[] = [
  {
    key: 'production',
    title: '排程与生产',
    items: [
      { key: '/leader', label: '小组长工作台', requiredPermission: 'leader:read' },
      { key: '/worker', label: '工人工作台', requiredPermission: 'worker:read' },
    ],
  },
  {
    key: 'org',
    title: '组织与账号',
    items: [
      // 厂长（含组织管理员角色）专属：组织架构 / 账号分配 / 角色权限。
      { key: '/org', label: '组织架构', requiredPermission: 'org:write', roles: ['factory-director', 'org-admin'] },
      { key: '/accounts', label: '账号管理', requiredPermission: 'account:write', roles: ['factory-director', 'org-admin'] },
      { key: '/roles', label: '角色与权限', requiredPermission: 'role:manage', roles: ['factory-director', 'org-admin'] },
    ],
  },
];

export const filterSidebarGroups = (role: RolePermission | null | undefined): SidebarGroupDef[] => {
  if (!role) {
    return sidebarGroups;
  }
  return sidebarGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          (item.roles == null || item.roles.includes(role.id)) &&
          (item.requiredPermission == null || hasPermission(role, item.requiredPermission)),
      ),
    }))
    .filter((group) => group.items.length > 0);
};
