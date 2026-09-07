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

export const sidebarGroups: SidebarGroupDef[] = [
  {
    key: 'workbench',
    title: '我的工作台',
    items: [
      { key: '/quality', label: '品保流程监督', requiredPermission: 'quality:supervise', roles: ['quality-assurance', 'factory-director'] },
      { key: '/dashboard', label: 'Dashboard', requiredPermission: 'dashboard:read' },
      { key: '/cockpit', label: '驾驶舱', requiredPermission: 'dashboard:read' },
      // 任务看板为厂长/管理视图，工人/组长默认不展示（保持「工人只见自己任务」的最小化原则）。
      { key: '/tasks', label: '任务看板', requiredPermission: null, roles: ['factory-director'] },
    ],
  },
  {
    key: 'engineering',
    title: '识别与工程',
    items: [
      { key: '/modules/m0-review', label: 'M0 文档解析审核', requiredPermission: 'm1:read' },
      { key: '/modules/bom-review', label: 'BOM 审核', requiredPermission: 'm1:read' },
      { key: '/modules/sop', label: 'SOP 查看', requiredPermission: 'm1:read' },
    ],
  },
  {
    key: 'procurement',
    title: '物料与采购',
    items: [
      { key: '/modules/m3-procurement', label: 'M3 物料计划', requiredPermission: 'm4:read' },
      { key: '/modules/purchase-warnings', label: 'M4 采购追踪', requiredPermission: 'm4:read' },
    ],
  },
  {
    key: 'production',
    title: '排程与生产',
    items: [
      { key: '/leader', label: '小组长工作台', requiredPermission: 'leader:read' },
      { key: '/worker', label: '工人工作台', requiredPermission: 'worker:read' },
      { key: '/modules/schedule', label: '排程甘特图', requiredPermission: 'schedule:read' },
      { key: '/modules/m5-flow', label: 'M5 流程看板', requiredPermission: 'schedule:read' },
      // 品控看板为厂长总览视图。
      { key: '/modules/qc', label: '品控看板', requiredPermission: null, roles: ['factory-director'] },
      { key: '/modules/sample-work-orders', label: '打样组看板', requiredPermission: 'schedule:read' },
    ],
  },
  {
    key: 'trace',
    title: '业务追踪',
    items: [
      { key: '/modules/trace-workbench', label: '业务追溯工作台', requiredPermission: 'dashboard:read' },
      { key: '/modules/finished-goods', label: '成品库', requiredPermission: 'dashboard:read' },
      { key: '/modules/warehouse-reconcile', label: '仓库出库对账', requiredPermission: 'dashboard:read' },
      { key: '/modules/legal-final-review', label: '法务终审', requiredPermission: null, roles: ['factory-director'], legal: true },
    ],
  },
  {
    key: 'system',
    title: '系统与审计',
    items: [
      // M0 数据建设/知识 Wiki 属于数据工程域，收敛给厂长总览，避免出现在工人/组长导航。
      { key: '/modules/data-construction', label: 'M0 数据建设', requiredPermission: null, roles: ['factory-director'] },
      { key: '/modules/m0-wiki', label: 'M0 知识 Wiki', requiredPermission: null, roles: ['factory-director'] },
      { key: '/audit', label: '操作留痕', requiredPermission: 'audit:read' },
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
