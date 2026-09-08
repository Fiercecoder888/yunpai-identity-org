// 默认落地页 = Agent 对话页（/home 已随角色首页一起删除）。
export const HOME_PATH = '/' as const;

export const demoRoleStorageKey = 'mockRoleId';

export type RoleLandingKind = 'factory-director' | 'quality-assurance' | 'team-leader' | 'worker' | 'default';

export type RoleLandingConfig = {
  kind: RoleLandingKind;
  title: string;
  description: string;
  landingPath: string;
  metrics: string[];
};

/**
 * 四角色体系：厂长（总控全权限）/ 品保（M7 抽检、放行与拒收）/
 * 组长（排程、派工与班组）/ 工人（我的订单与报工）。
 */
export const roleLandingConfigById: Record<string, RoleLandingConfig> = {
  'factory-director': {
    kind: 'factory-director',
    title: '厂长驾驶舱',
    description: '全局总控：Agent 对话页内管理订单全链路（M1→M5）、排程、采购与基础数据',
    // 厂长绑定 Agent 对话页面（企业助手）：上传订单、数据流闸门、PMC 与 m0 基础数据都在这里。
    landingPath: '/',
    metrics: ['modules', 'highRisk', 'risks', 'activities'],
  },
  'quality-assurance': {
    kind: 'quality-assurance',
    title: '品保工作台',
    description: '处理 M7 来料待验、抽样记录、合格放行与不合格拒收',
    landingPath: '/',
    metrics: ['pendingInspection', 'sampling', 'passed', 'rejected'],
  },
  'team-leader': {
    kind: 'team-leader',
    title: '小组长工作台',
    description: '今日任务、排程派工、报工与班组工作量台账',
    landingPath: '/leader',
    metrics: ['todayTasks', 'pendingReport', 'workload', 'variance'],
  },
  worker: {
    kind: 'worker',
    title: '我的工作台',
    description: '我的订单、今日任务与报工',
    landingPath: '/worker',
    metrics: ['myOrders', 'todayTasks', 'report'],
  },
};

export const defaultRoleLanding: RoleLandingConfig = {
  kind: 'default',
  title: '角色首页',
  description: '按角色展示业务入口与待办',
  landingPath: HOME_PATH,
  metrics: [],
};

export const landingKindForRoleId = (roleId: string | undefined): RoleLandingConfig =>
  (roleId ? roleLandingConfigById[roleId] : undefined) ?? defaultRoleLanding;
