export type ApiErrorCode = 'unauthorized' | 'forbidden' | 'server_error' | 'network_error' | 'parse_error' | 'timeout' | 'business_error' | 'not_implemented';

export type ApiError = {
  code: ApiErrorCode;
  status?: number;
  message: string;
  detail?: unknown;
  traceId?: string;
};

export type ApiResult<T> = {
  data: T;
};

export type ModuleStatus = {
  id: string;
  name: string;
  status: 'normal' | 'running' | 'warning' | 'error' | 'pending';
  metric: number;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
};

export type TaskItem = {
  id: string;
  title: string;
  owner: string;
  status: 'pending' | 'running' | 'need_review' | 'completed' | 'failed' | 'cancelled';
  riskLevel: 'low' | 'medium' | 'high';
  /** 后端未提供时间戳时缺省（M1 任务列表不保证 updated_at），渲染用「—」而非 1970 占位。 */
  updatedAt?: string;
};

export type AuditLogItem = {
  id: string;
  time: string;
  actor: string;
  action: string;
  module: string;
  targetId: string;
  result: 'success' | 'failed' | 'blocked';
  detail: string;
};

export type AgentActivity = {
  id: string;
  time: string;
  module: string;
  message: string;
  status: 'info' | 'success' | 'warning' | 'error';
};

export type RiskItem = {
  id: string;
  title: string;
  module: string;
  level: 'low' | 'medium' | 'high';
  description: string;
};

export type DashboardSummary = {
  modules: ModuleStatus[];
  activities: AgentActivity[];
  risks: RiskItem[];
};

export type M1RecognitionTask = {
  id: string;
  filename: string;
  status: 'pending' | 'running' | 'need_review' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  fileStatus: Array<{
    filename: string;
    status: M1RecognitionTask['status'];
    error?: string;
  }>;
};

export type M1ReviewItem = {
  id: string;
  taskId: string;
  field: string;
  recognizedValue: string;
  recognizedValueTruncated?: boolean;
  correctedValue?: string;
  confidence: number;
  status: 'pending' | 'confirmed';
};

export type BomItem = {
  id: string;
  code: string;
  name: string;
  quantity: number;
  unit: string;
  confidence: number;
  status: 'normal' | 'warning' | 'rejected' | 'approved';
};

export type SopStep = {
  id: string;
  title: string;
  equipment: string;
  durationMinutes: number | null;
  note: string;
};

export type PurchaseWarning = {
  id: string;
  supplier: string;
  item: string;
  overdueDays: number;
  severity: 'medium' | 'high';
  status: 'open' | 'followed';
};

export type LegalRisk = {
  id: string;
  title: string;
  riskLevel: 'medium' | 'high';
  reviewRound: string;
  summary: string;
  status: 'pending' | 'approved' | 'rejected' | 'escalated';
};

export type ScheduleResource = {
  id: string;
  name: string;
};

export type ScheduleTask = {
  id: string;
  title: string;
  resourceId: string;
  startDay: number;
  durationDays: number;
  status: 'draft' | 'solving' | 'solved' | 'conflict' | 'adjusted' | 'published';
  planVersion?: string;
  orderId?: string;
  operationId?: string;
  /** 后端原始状态，用于区分计划/锁定/WIP/延误视觉档位（缺省时由 status 推导）。 */
  rawStatus?: string;
  /** 实际开始/持续时间（M5 排程契约未保证；缺字段时前端标「未提供」，不伪造）。 */
  actualStartDay?: number;
  actualDurationDays?: number;
  actualStartAt?: string;
  actualEndAt?: string;
  actualQty?: number;
  actualStatus?: string;
  /** 关键路径标记（契约未保证；缺字段时前端标「未提供」）。 */
  critical?: boolean;
  /** 工时（小时），用于产能负载计算（契约未保证；缺字段时标「未提供」）。 */
  workHours?: number;
  /** M5 工序原始精确时间（ISO-8601）；拖拽平移时按原始值平移，避免按天重建 08:00-18:00。 */
  startAt?: string;
  endAt?: string;
  /** 原始持续时间（毫秒），仅保留信息，布局仍以 durationDays 为准。 */
  durationMs?: number;
  /** M5 调整响应可能携带的校验状态；false 表示排程需后端重新校验。 */
  validationPassed?: boolean;
};

export type ScheduleConflict = {
  id: string;
  taskId: string;
  level: 'medium' | 'high';
  message: string;
};

export type ScheduleDependency = {
  id: string;
  predecessorId: string;
  successorId: string;
  type: 'finish_to_start' | 'start_to_start';
  lagDays: number;
};

export type ScheduleBoard = {
  resources: ScheduleResource[];
  tasks: ScheduleTask[];
  conflicts: ScheduleConflict[];
  timelineStart?: string;
  /** M5 排程生命周期：draft / approved / released（来自列表 head 或详情） */
  lifecycleStatus?: string;
  /** 求解器校验是否通过，未通过的排程不能审批/发布 */
  validationPassed?: boolean;
  /** 场景用途：production / pressure_only */
  scenarioPurpose?: string;
  planVersion?: string;
  approvedAt?: string;
  releasedAt?: string;
  /** 计划所属 Tracking TaskID（来自列表 head），子版本操作需继承并透传 */
  trackingTaskId?: string;
};
