import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { WorkbenchLayout } from '../layouts/WorkbenchLayout';
import { AssistantRoleLayout } from '../layouts/AssistantRoleLayout';
import { RoleGuard } from './RoleGuard';

const EnterpriseAssistantPage = lazy(() =>
  import('../pages/EnterpriseAssistantPage').then((module) => ({ default: module.EnterpriseAssistantPage })),
);
const LeaderWorkbenchPage = lazy(() =>
  import('../pages/LeaderWorkbenchPage').then((module) => ({ default: module.LeaderWorkbenchPage })),
);
const WorkerPage = lazy(() => import('../pages/WorkerPage').then((module) => ({ default: module.WorkerPage })));
const OrgStructurePage = lazy(() =>
  import('../pages/OrgStructurePage').then((module) => ({ default: module.OrgStructurePage })),
);
const AccountsPage = lazy(() =>
  import('../pages/AccountsPage').then((module) => ({ default: module.AccountsPage })),
);
const RolesPermissionsPage = lazy(() =>
  import('../pages/RolesPermissionsPage').then((module) => ({ default: module.RolesPermissionsPage })),
);

const withSuspense = (element: ReactNode) => <Suspense fallback={<div className="route-loading">页面加载中...</div>}>{element}</Suspense>;

export type RouteMeta = {
  navTitle: string;
  /** 兼容别名：等于 navTitle，供标签页/命令面板等既有消费方使用。 */
  title: string;
  pageTitle?: string;
  breadcrumb?: string;
  groupKey?: string;
  icon?: string;
  description?: string;
  closable: boolean;
};

const routeMetaSource = {
  '/leader': { navTitle: '小组长工作台', groupKey: 'production', icon: 'leader', description: '今日任务、报工、班组工作量台账、工时对比与订单追溯', closable: true },
  '/worker': { navTitle: '工人工作台', groupKey: 'production', icon: 'leader', description: '我的订单与对话报工', closable: true },
  '/quality': { navTitle: '品保工作台', groupKey: 'quality', icon: 'audit', description: 'M7 来料待验、抽样记录、合格放行与不合格拒收', closable: true },
  '/org': { navTitle: '组织架构', groupKey: 'org', icon: 'leader', description: '公司 → 部门 → 班组 三层组织树；增删节点、查看来源（手工/花名册派生）', closable: true },
  '/accounts': { navTitle: '账号管理', groupKey: 'org', icon: 'leader', description: '给员工分配账号与角色、重置初始密码、启用停用', closable: true },
  '/roles': { navTitle: '角色与权限', groupKey: 'org', icon: 'audit', description: '权限目录与角色矩阵（只读）：13 项权限 × 9 个角色', closable: true },
} as const;

export type AppPath = keyof typeof routeMetaSource;

export const routeMeta: Record<AppPath, RouteMeta> = Object.fromEntries(
  Object.entries(routeMetaSource).map(([path, meta]) => [path, { ...meta, title: meta.navTitle }]),
) as Record<AppPath, RouteMeta>;

export const isAppPath = (path: string): path is AppPath => path in routeMeta;

export const router = createBrowserRouter([
  {
    path: '/',
    children: [
      { index: true, element: withSuspense(<EnterpriseAssistantPage />) },
      { path: 'c/:conversationId', element: withSuspense(<EnterpriseAssistantPage />) },
      // 品保落地页 /quality：与厂长同一个对话页（EnterpriseAssistantPage），
      // 差别只在可见性——品保看不到 M1–M5 面板、没有分配账号、没有查流程入口（由权限与页面内容收口）。
      { path: 'quality', element: withSuspense(<RoleGuard path="/quality"><EnterpriseAssistantPage /></RoleGuard>) },
      {
        element: <AssistantRoleLayout />,
        children: [
          { path: 'worker', element: withSuspense(<RoleGuard path="/worker"><WorkerPage /></RoleGuard>) },
          { path: 'leader', element: withSuspense(<RoleGuard path="/leader"><LeaderWorkbenchPage /></RoleGuard>) },
        ],
      },
      {
        element: <WorkbenchLayout />,
        children: [
          { path: 'org', element: withSuspense(<RoleGuard path="/org"><OrgStructurePage /></RoleGuard>) },
          { path: 'accounts', element: withSuspense(<RoleGuard path="/accounts"><AccountsPage /></RoleGuard>) },
          { path: 'roles', element: withSuspense(<RoleGuard path="/roles"><RolesPermissionsPage /></RoleGuard>) },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
