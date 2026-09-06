import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { CockpitLayout } from '../layouts/CockpitLayout';
import { WorkbenchLayout } from '../layouts/WorkbenchLayout';
import { AssistantRoleLayout } from '../layouts/AssistantRoleLayout';
import { RoleGuard } from './RoleGuard';

const AuditLogPage = lazy(() => import('../pages/AuditLogPage').then((module) => ({ default: module.AuditLogPage })));
const BomReviewPage = lazy(() => import('../pages/BomReviewPage').then((module) => ({ default: module.BomReviewPage })));
const BusinessTraceWorkbenchPage = lazy(() =>
  import('../pages/BusinessTraceWorkbenchPage').then((module) => ({ default: module.BusinessTraceWorkbenchPage })),
);
const CockpitPage = lazy(() => import('../pages/CockpitPage').then((module) => ({ default: module.CockpitPage })));
const DashboardPage = lazy(() => import('../pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const DataConstructionPage = lazy(() =>
  import('../pages/DataConstructionPage').then((module) => ({ default: module.DataConstructionPage })),
);
const EnterpriseAssistantPage = lazy(() =>
  import('../pages/EnterpriseAssistantPage').then((module) => ({ default: module.EnterpriseAssistantPage })),
);
const FinishedGoodsPage = lazy(() =>
  import('../pages/FinishedGoodsPage').then((module) => ({ default: module.FinishedGoodsPage })),
);
const LegalFinalReviewPage = lazy(() => import('../pages/LegalFinalReviewPage').then((module) => ({ default: module.LegalFinalReviewPage })));
const LeaderWorkbenchPage = lazy(() =>
  import('../pages/LeaderWorkbenchPage').then((module) => ({ default: module.LeaderWorkbenchPage })),
);
const M1ReviewPage = lazy(() => import('../pages/M1ReviewPage').then((module) => ({ default: module.M1ReviewPage })));
const M0WikiPage = lazy(() => import('../pages/M0WikiPage').then((module) => ({ default: module.M0WikiPage })));
const M3ProcurementPage = lazy(() => import('../pages/M3ProcurementPage').then((module) => ({ default: module.M3ProcurementPage })));
const M5FlowDashboardPage = lazy(() =>
  import('../pages/M5FlowDashboardPage').then((module) => ({ default: module.M5FlowDashboardPage })),
);
const PurchaseWarningsPage = lazy(() => import('../pages/PurchaseWarningsPage').then((module) => ({ default: module.PurchaseWarningsPage })));
const QualitySupervisionPage = lazy(() => import('../pages/QualitySupervisionPage').then((module) => ({ default: module.QualitySupervisionPage })));
const QcDashboardPage = lazy(() => import('../pages/QcDashboardPage').then((module) => ({ default: module.QcDashboardPage })));
const RoleHomePage = lazy(() => import('../pages/RoleHomePage').then((module) => ({ default: module.RoleHomePage })));
const ScheduleGanttPage = lazy(() => import('../pages/ScheduleGanttPage').then((module) => ({ default: module.ScheduleGanttPage })));
const SampleWorkOrdersPage = lazy(() =>
  import('../pages/SampleWorkOrdersPage').then((module) => ({ default: module.SampleWorkOrdersPage })),
);
const SopPage = lazy(() => import('../pages/SopPage').then((module) => ({ default: module.SopPage })));
const TaskBoardPage = lazy(() => import('../pages/TaskBoardPage').then((module) => ({ default: module.TaskBoardPage })));
const WorkerPage = lazy(() => import('../pages/WorkerPage').then((module) => ({ default: module.WorkerPage })));
const WarehouseReconcilePage = lazy(() =>
  import('../pages/WarehouseReconcilePage').then((module) => ({ default: module.WarehouseReconcilePage })),
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
  '/home': { navTitle: '角色首页', groupKey: 'workbench', icon: 'home', description: '按角色聚合待办、风险与常用入口', closable: true },
  '/quality': { navTitle: '品保流程监督', groupKey: 'workbench', icon: 'quality', description: '只读查看 M1-M5 全流程进度、异常与任务提醒', closable: false },
  '/dashboard': { navTitle: 'Dashboard', groupKey: 'workbench', icon: 'dashboard', description: '模块状态、风险摘要与最近 Agent 活动', closable: false },
  '/cockpit': { navTitle: '驾驶舱', groupKey: 'workbench', icon: 'cockpit', description: '深色三列驾驶舱大屏', closable: false },
  '/tasks': { navTitle: '任务看板', groupKey: 'workbench', icon: 'tasks', description: '任务列表、状态、负责人和风险等级。', closable: true },
  '/leader': { navTitle: '小组长工作台', groupKey: 'production', icon: 'leader', description: '今日任务、报工、班组工作量台账、工时对比与订单追溯', closable: true },
  '/worker': { navTitle: '工人工作台', groupKey: 'production', icon: 'leader', description: '我的订单与对话报工', closable: true },
  '/modules/m0-review': { navTitle: 'M0 文档解析审核', groupKey: 'engineering', icon: 'm1-review', description: '上传、批量识别与人工确认', closable: true },
  '/modules/m0-wiki': { navTitle: 'M0 知识 Wiki', groupKey: 'engineering', icon: 'data-construction', description: '规范库只读知识视图：产品索引、BOM 修订与 diff、关系图、物料/设备反查', closable: true },
  '/modules/m3-procurement': { navTitle: 'M3 物料计划', groupKey: 'procurement', icon: 'm3-procurement', description: '物料计划、审批与交接', closable: true },
  '/modules/bom-review': { navTitle: 'BOM 审核', groupKey: 'engineering', icon: 'bom-review', description: 'BOM 物料审核与驳回', closable: true },
  '/modules/sop': { navTitle: 'SOP 查看', groupKey: 'engineering', icon: 'sop', description: 'SOP 步骤查看', closable: true },
  '/modules/purchase-warnings': { navTitle: 'M4 采购追踪', groupKey: 'procurement', icon: 'purchase-warnings', description: '采购建议、供应商回复、交期追踪和预警闭环', closable: true },
  '/modules/m5-flow': { navTitle: 'M5 流程看板', groupKey: 'production', icon: 'm5-flow', description: '查询 M5 已持久化的输入、排程版本、审批派发、执行回传和 Tracking Outbox。', closable: true },
  '/modules/qc': { navTitle: '品控看板', groupKey: 'production', icon: 'qc', description: '品控数据链路：采集量、最近事件与数据源状态（预警/模型占位）', closable: true },
  '/modules/trace-workbench': { navTitle: '业务追溯工作台', groupKey: 'trace', icon: 'trace-workbench', description: '按 Tracking TaskID 追溯业务链路', closable: true },
  '/modules/finished-goods': { navTitle: '成品库', groupKey: 'trace', icon: 'finished-goods', description: '成品库存与良率概览', closable: true },
  '/modules/warehouse-reconcile': { navTitle: '仓库出库对账', groupKey: 'trace', icon: 'warehouse-reconcile', description: '实际领料与标准用量差异对账，订单级出库流向联查', closable: true },
  '/modules/schedule': { navTitle: '排程甘特图', groupKey: 'production', icon: 'schedule', description: '排程甘特图、资源筛选与任务调整', closable: true },
  '/modules/sample-work-orders': { navTitle: '打样组看板', groupKey: 'production', icon: 'sample-work-orders', description: '预订单/样品单独立打样流程台账（不进入正式排程与采购）', closable: true },
  '/modules/legal-final-review': { navTitle: '法务终审', groupKey: 'trace', icon: 'legal-final-review', description: '隔离的样例终审流程', closable: true },
  '/modules/data-construction': { navTitle: 'M0 数据建设', groupKey: 'system', icon: 'data-construction', description: '数据导入、解析、裁决与入库', closable: true },
  '/audit': { navTitle: '操作留痕', groupKey: 'system', icon: 'audit', description: '权限与操作留痕审计', closable: true },
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
      {
        path: 'cockpit',
        element: withSuspense(<CockpitLayout />),
        children: [{ index: true, element: withSuspense(<CockpitPage />) }],
      },
      {
        element: <AssistantRoleLayout />,
        children: [
          { path: 'worker', element: withSuspense(<RoleGuard path="/worker"><WorkerPage /></RoleGuard>) },
          { path: 'leader', element: withSuspense(<RoleGuard path="/leader"><LeaderWorkbenchPage /></RoleGuard>) },
          { path: 'quality', element: withSuspense(<RoleGuard path="/quality"><QualitySupervisionPage /></RoleGuard>) },
        ],
      },
      {
        element: <WorkbenchLayout />,
        children: [
          { path: 'home', element: withSuspense(<RoleGuard path="/home"><RoleHomePage /></RoleGuard>) },
          { path: 'dashboard', element: withSuspense(<RoleGuard path="/dashboard"><DashboardPage /></RoleGuard>) },
          { path: 'tasks', element: withSuspense(<RoleGuard path="/tasks"><TaskBoardPage /></RoleGuard>) },
          { path: 'modules/m0-review', element: withSuspense(<RoleGuard path="/modules/m0-review"><M1ReviewPage /></RoleGuard>) },
          { path: 'modules/m0-wiki', element: withSuspense(<RoleGuard path="/modules/m0-wiki"><M0WikiPage /></RoleGuard>) },
          { path: 'modules/m3-procurement', element: withSuspense(<RoleGuard path="/modules/m3-procurement"><M3ProcurementPage /></RoleGuard>) },
          { path: 'modules/bom-review', element: withSuspense(<RoleGuard path="/modules/bom-review"><BomReviewPage /></RoleGuard>) },
          { path: 'modules/sop', element: withSuspense(<RoleGuard path="/modules/sop"><SopPage /></RoleGuard>) },
          { path: 'modules/purchase-warnings', element: withSuspense(<RoleGuard path="/modules/purchase-warnings"><PurchaseWarningsPage /></RoleGuard>) },
          { path: 'modules/m5-flow', element: withSuspense(<RoleGuard path="/modules/m5-flow"><M5FlowDashboardPage /></RoleGuard>) },
          { path: 'modules/qc', element: withSuspense(<RoleGuard path="/modules/qc"><QcDashboardPage /></RoleGuard>) },
          { path: 'modules/trace-workbench', element: withSuspense(<RoleGuard path="/modules/trace-workbench"><BusinessTraceWorkbenchPage /></RoleGuard>) },
          { path: 'modules/finished-goods', element: withSuspense(<RoleGuard path="/modules/finished-goods"><FinishedGoodsPage /></RoleGuard>) },
          { path: 'modules/warehouse-reconcile', element: withSuspense(<RoleGuard path="/modules/warehouse-reconcile"><WarehouseReconcilePage /></RoleGuard>) },
          { path: 'modules/schedule', element: withSuspense(<RoleGuard path="/modules/schedule"><ScheduleGanttPage /></RoleGuard>) },
          { path: 'modules/sample-work-orders', element: withSuspense(<RoleGuard path="/modules/sample-work-orders"><SampleWorkOrdersPage /></RoleGuard>) },
          { path: 'modules/legal-final-review', element: withSuspense(<RoleGuard path="/modules/legal-final-review"><LegalFinalReviewPage /></RoleGuard>) },
          { path: 'modules/data-construction', element: withSuspense(<RoleGuard path="/modules/data-construction"><DataConstructionPage /></RoleGuard>) },
          { path: 'audit', element: withSuspense(<RoleGuard path="/audit"><AuditLogPage /></RoleGuard>) },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
