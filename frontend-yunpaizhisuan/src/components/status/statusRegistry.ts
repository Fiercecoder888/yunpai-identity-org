import { statusColors } from '../statusColors';

export type StatusDefinition = {
  label: string;
  color: string;
};

const hex = statusColors;

export const statusDefinitions: Record<string, StatusDefinition> = {
  // 通用状态
  normal: { label: '正常', color: hex.success },
  running: { label: '运行中', color: hex.info },
  warning: { label: '预警', color: hex.warning },
  error: { label: '异常', color: hex.risk },
  pending: { label: '待处理', color: hex.neutral },
  success: { label: '成功', color: hex.success },
  failed: { label: '失败', color: hex.risk },
  cancelled: { label: '已取消', color: hex.neutral },
  completed: { label: '已完成', color: hex.success },
  blocked: { label: '阻断', color: hex.risk },
  none: { label: '无', color: hex.neutral },
  high: { label: '高', color: hex.risk },
  medium: { label: '中', color: hex.warning },
  low: { label: '低', color: hex.info },

  // M1 / 任务
  need_review: { label: '待审核', color: hex.warning },

  // M4 采购
  pending_review: { label: '待审核', color: hex.warning },
  approved: { label: '已通过', color: hex.success },
  rejected: { label: '已驳回', color: hex.risk },
  pending_send: { label: '待发送', color: hex.info },
  sent: { label: '已发送', color: hex.info },
  replied: { label: '已回复', color: hex.cyan },
  parse_pending_review: { label: '解析待确认', color: hex.warning },
  tracking: { label: '追踪中', color: hex.info },
  alerted: { label: '已预警', color: hex.risk },
  draft: { label: '草稿', color: hex.neutral },
  confirmed: { label: '已确认', color: hex.success },
  partial_received: { label: '部分到货', color: hex.warning },
  received: { label: '已到货', color: hex.success },
  overdue: { label: '已超期', color: hex.risk },
  closed_exception: { label: '异常关闭', color: hex.neutral },
  open: { label: '未处理', color: hex.risk },
  processing: { label: '处理中', color: hex.warning },
  closed: { label: '已关闭', color: hex.neutral },
  due_soon: { label: '即将到期', color: hex.warning },
  supplier_exception: { label: '供应商异常', color: hex.risk },
  not_received: { label: '未到货', color: hex.neutral },
  valid: { label: '有效', color: hex.success },
  invalid: { label: '无效', color: hex.risk },
  duplicate: { label: '重复', color: hex.warning },

  // M5 排程流程
  not_started: { label: '未开始', color: hex.neutral },
  queued: { label: '排队中', color: hex.info },
  succeeded: { label: '已完成', color: hex.success },
  dead_letter: { label: '死信', color: hex.risk },
  active: { label: '进行中', color: hex.info },
  complete: { label: '完整', color: hex.success },
  attention: { label: '需处理', color: hex.risk },
  off: { label: '关闭', color: hex.neutral },
  shadow: { label: '影子', color: hex.warning },
  strict: { label: '严格', color: hex.risk },

  // 排程状态
  solving: { label: '求解中', color: hex.info },
  solved: { label: '已求解', color: hex.success },
  conflict: { label: '冲突', color: hex.risk },
  adjusted: { label: '已调整', color: hex.info },
  published: { label: '已发布', color: hex.success },

  // Agent 编排节点
  idle: { label: '空闲', color: hex.neutral },
  waiting_human: { label: '待人工', color: hex.warning },

  // Orchestrator Job
  done: { label: '完成', color: hex.success },
  partial: { label: '部分完成', color: hex.warning },
  ok: { label: '正常', color: hex.success },

  // M3 物料就绪 / 采购计划
  ready: { label: '就绪', color: hex.success },
  allocated_by_fifo: { label: 'FIFO 已分配', color: hex.info },
  covered_by_stock_or_open_po: { label: '库存/在途覆盖', color: hex.cyan },
  shortage: { label: '缺料', color: hex.risk },
  blocked_by_data_quality: { label: '数据质量阻断', color: hex.risk },
  blocked_by_unresolved_shortage: { label: '缺料未决阻断', color: hex.risk },
  shortage_with_procurement_plan: { label: '缺料有采购计划', color: hex.warning },
  do_not_release_formal_schedule: { label: '禁止正式排程', color: hex.risk },
  allow_draft_schedule_only: { label: '仅允许草稿排程', color: hex.warning },
  ready_for_formal_schedule: { label: '可正式排程', color: hex.success },
  blocked_by_procurement_approval: { label: '采购审批阻断', color: hex.risk },
  draft_ready_for_external_system: { label: '草稿待外部系统', color: hex.warning },
};

export const statusLabel = (status: string): string => statusDefinitions[status]?.label ?? status;

export const statusColor = (status: string): string => statusDefinitions[status]?.color ?? 'default';
