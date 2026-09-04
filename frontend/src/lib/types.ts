export type RunStatus = 'queued' | 'running' | 'waiting_human' | 'completed' | 'failed';
export type ModuleName = 'm0' | 'm1' | 'm2' | 'm3' | 'm4' | 'm5';
export type AttachmentKind = 'order' | 'master_data';

export type Attachment = {
  id: string;
  kind: AttachmentKind;
  filename: string;
  content_type: string;
  content_b64: string;
  size: number;
};

export type Step = {
  id: string;
  module: string;
  tool: string;
  mode?: string;
  gate?: string | null;
  status?: string;
  output_summary?: Record<string, unknown>;
  error?: Record<string, unknown>;
};

export type Gate = {
  type: string;
  module: string;
  tool: string;
  message: string;
  actions?: string[];
  step_index: number;
  pre_execution?: boolean;
};

export type RunState = {
  run_id: string;
  task_id: string;
  tenant_id?: string;
  request?: Record<string, unknown>;
  route?: string;
  workflow_id?: string;
  workflow_version?: string;
  plan?: Step[];
  next_step_index?: number;
  current_step?: string;
  status: RunStatus;
  outputs?: Record<string, any>;
  steps?: Step[];
  pending_gate?: Gate | null;
  approvals?: Array<Record<string, unknown>>;
  errors?: Array<Record<string, unknown>>;
  response?: string;
  trace?: Array<Record<string, unknown>>;
};

export type PmcOperation = {
  schedule_operation_id: string;
  order_line_id: string;
  product_code: string;
  op_code: string;
  operation_name?: string;
  equipment_code?: string;
  person_code?: string;
  station_code?: string;
  tooling_codes?: string[];
  plan_start: string;
  plan_end: string;
  qty: string | number;
  uom: string;
  setup_minutes: number;
  processing_minutes: number;
  standard_minutes?: number;
  quantity_basis?: number;
  yield_rate?: number;
  loss_rate?: number;
  wip_state?: string;
};

export type StreamEvent = {
  type: 'run_start' | 'assistant_delta' | 'step_start' | 'step_result' | 'gate_opened' | 'state_snapshot' | 'run_done' | 'run_error';
  run_id: string;
  task_id: string;
  at: string;
  content?: string;
  state?: RunState;
  step?: Step;
  output_summary?: Record<string, unknown>;
  gate?: Gate;
  code?: string;
  message?: string;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
};

export type Activity = {
  id: string;
  kind: 'planner' | 'step' | 'reviewer' | 'gate' | 'system';
  label: string;
  detail: string;
  status: 'running' | 'completed' | 'waiting' | 'failed';
  module?: string;
};

export const MODULES: Array<{ id: ModuleName; name: string; description: string }> = [
  { id: 'm0', name: 'M0 数据事实', description: '候选数据与 canonical 发布' },
  { id: 'm1', name: 'M1 订单解析', description: '订单字段与证据抽取' },
  { id: 'm2', name: 'M2 工程设计', description: 'BOM 与 SOP 草稿' },
  { id: 'm3', name: 'M3 物料计划', description: 'MRP、缺料与齐套' },
  { id: 'm4', name: 'M4 采购协同', description: '采购建议与供应商' },
  { id: 'm5', name: 'M5 生产排程', description: '资源约束与计划版本' },
];
