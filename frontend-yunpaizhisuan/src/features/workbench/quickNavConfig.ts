import type { ComponentType } from 'react';
import {
  AuditOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  FundProjectionScreenOutlined,
  EyeOutlined,
  ScheduleOutlined,
  TeamOutlined,
  ToolOutlined,
  UserOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { PermissionCode } from '../../services/permissionApi';

export type QuickNavItem = {
  key: string;
  title: string;
  description: string;
  path: string;
  icon: ComponentType;
  permission?: PermissionCode;
};

export type RoleQuickNav = {
  roleId: string;
  roleName: string;
  description: string;
  items: QuickNavItem[];
};

/**
 * 四角色快捷导航：厂长（全量总览）/ 品保（只读流程监督）/
 * 组长（排程、派工与班组）/ 工人（我的订单与报工）。
 * 工人只保留与自身相关的入口，避免看到无关业务页面。
 */
export const roleQuickNavs: RoleQuickNav[] = [
  {
    roleId: 'factory-director',
    roleName: '厂长',
    description: '全局 KPI、模块健康与风险，全部业务入口',
    items: [
      { key: 'dashboard', title: 'Dashboard', description: '模块健康与风险摘要', path: '/dashboard', icon: DashboardOutlined, permission: 'dashboard:read' },
      { key: 'schedule', title: '排程甘特图', description: '计划与产能视图', path: '/modules/schedule', icon: ScheduleOutlined, permission: 'schedule:read' },
      { key: 'm5-flow', title: 'M5 流程看板', description: '排程流程与派发', path: '/modules/m5-flow', icon: FundProjectionScreenOutlined, permission: 'schedule:read' },
      { key: 'leader', title: '小组长工作台', description: '班组、派工与报工', path: '/leader', icon: TeamOutlined, permission: 'leader:read' },
      { key: 'worker', title: '工人工作台', description: '工人视角查看订单与报工', path: '/worker', icon: UserOutlined, permission: 'worker:read' },
      { key: 'purchase', title: 'M4 采购追踪', description: '预警、追踪与订单', path: '/modules/purchase-warnings', icon: WarningOutlined, permission: 'm4:read' },
      { key: 'trace', title: '业务追溯', description: '订单与物料追溯', path: '/modules/trace-workbench', icon: DatabaseOutlined, permission: 'dashboard:read' },
      { key: 'audit', title: '操作留痕', description: '权限与操作审计', path: '/audit', icon: AuditOutlined, permission: 'audit:read' },
    ],
  },
  {
    roleId: 'quality-assurance',
    roleName: '品保',
    // 品保口径（2026-09-10）：落地 /quality，与厂长同一个对话页，但**看不到 M1–M5 主链进度**、
    // 没有查流程与分配账号权限。这里不再承诺「全流程进度监督」。
    description: 'M7 来料待验、抽样与放行',
    items: [
      { key: 'quality', title: '品保工作台', description: 'M7 来料待验、抽样记录与合格放行', path: '/quality', icon: EyeOutlined, permission: 'quality:supervise' },
    ],
  },
  {
    roleId: 'team-leader',
    roleName: '组长',
    description: '排程甘特、派工与班组报工',
    items: [
      { key: 'leader', title: '小组长工作台', description: '今日任务、派工与报工', path: '/leader', icon: TeamOutlined, permission: 'leader:read' },
      { key: 'schedule', title: '排程甘特图', description: '计划与产能视图', path: '/modules/schedule', icon: ScheduleOutlined, permission: 'schedule:read' },
      { key: 'm5-flow', title: 'M5 流程看板', description: '排程流程与派发', path: '/modules/m5-flow', icon: FundProjectionScreenOutlined, permission: 'schedule:read' },
      { key: 'worker', title: '工人工作台', description: '查看组内工人订单', path: '/worker', icon: UserOutlined, permission: 'worker:read' },
    ],
  },
  {
    roleId: 'worker',
    roleName: '生产工人',
    description: '我的订单、今日任务与报工',
    items: [
      { key: 'worker', title: '我的订单与报工', description: '查看绑定订单并报工', path: '/worker', icon: UserOutlined, permission: 'worker:read' },
      { key: 'chat', title: '对话报工', description: '自然语言报工时与产出', path: '/', icon: FileSearchOutlined, permission: 'chat:write' },
      { key: 'home', title: '角色首页', description: '我的工作台首页', path: '/home', icon: ToolOutlined },
    ],
  },
];

export const quickNavRoleIds = roleQuickNavs.map((nav) => nav.roleId);

export function findRoleQuickNav(roleId: string | undefined): RoleQuickNav | undefined {
  return roleQuickNavs.find((nav) => nav.roleId === roleId);
}

export function filterQuickNavItems(items: QuickNavItem[], permissions: PermissionCode[] | undefined): QuickNavItem[] {
  if (!permissions) {
    return items;
  }
  return items.filter((item) => item.permission == null || permissions.includes(item.permission));
}
