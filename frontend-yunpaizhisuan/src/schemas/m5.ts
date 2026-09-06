import { z } from 'zod';

// M5 持久化操作可能返回 null（如未回填的 resource_name/end_time），
// 归一化为 undefined，让下游适配器与既有类型一致。
const nullableText = z.string().nullish().transform((value) => value ?? undefined);
const nullableNumber = z.number().nullish().transform((value) => value ?? undefined);
const nullableBoolean = z.boolean().nullish().transform((value) => value ?? undefined);

export const m5ScheduleOperationSchema = z.object({
  order_id: nullableText,
  operation_id: nullableText,
  id: nullableText,
  title: nullableText,
  operation_name: nullableText,
  resource_id: nullableText,
  resource_name: nullableText,
  start_day: z.number().optional(),
  duration_days: z.number().optional(),
  start_time: nullableText,
  end_time: nullableText,
  plan_version: nullableText,
  status: nullableText,
  actual_start_time: nullableText,
  actual_end_time: nullableText,
  actual_qty: nullableNumber,
  actual_status: nullableText,
}).passthrough();

export const m5PmcProgressOperationSchema = z.object({
  order_id: z.string(),
  product_id: z.string(),
  operation_id: z.string(),
  operation_name: z.string(),
  resource_id: z.string(),
  planned_start_time: z.string(),
  planned_end_time: z.string(),
  planned_quantity: nullableNumber,
  unit: nullableText,
  actual_start_time: nullableText,
  actual_end_time: nullableText,
  actual_qty: nullableNumber,
  actual_status: z.enum(['not_started', 'running', 'paused', 'exception', 'scrapped', 'completed']),
  completion_rate_percent: nullableNumber,
}).passthrough();

export const m5PmcProgressOrderSchema = z.object({
  order_id: z.string(),
  product_id: nullableText,
  planned_quantity: nullableNumber,
  unit: nullableText,
  due_time: nullableText,
  actual_qty: nullableNumber,
  actual_quantity_supported: z.boolean(),
  terminal_operation_id: nullableText,
  completion_rate_percent: nullableNumber,
  planned_completion_time: nullableText,
  actual_completion_time: nullableText,
  status: z.enum(['unknown', 'not_started', 'wip', 'completed']),
  on_time: nullableBoolean,
  operations: z.array(m5PmcProgressOperationSchema),
}).passthrough();

export const m5PmcProgressSchema = z.object({
  plan_version: z.string(),
  generated_at: z.string(),
  summary: z.object({
    order_count: z.number().int().nonnegative(),
    completed_order_count: z.number().int().nonnegative(),
    wip_order_count: z.number().int().nonnegative(),
    late_order_count: z.number().int().nonnegative(),
    on_time_order_count: z.number().int().nonnegative(),
    on_time_rate_percent: z.number().min(0).max(100).nullish().transform((value) => value ?? undefined),
  }).passthrough(),
  orders: z.array(m5PmcProgressOrderSchema),
}).passthrough();

export const m5ScheduleSchema = z.object({
  plan_version: z.string().optional(),
  resources: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  tasks: z.array(z.unknown()).optional(),
  conflicts: z.array(z.unknown()).optional(),
  operations: z.array(m5ScheduleOperationSchema).optional(),
  // M5 版本列表/详情都携带排程生命周期字段；列表项无 operations，
  // 详情有 operations。统一在这里声明，供甘特页展示 head 生命周期。
  lifecycle_status: nullableText,
  tracking_task_id: z.string().nullable().optional(),
  validation_passed: z.boolean().optional(),
  scenario_purpose: nullableText,
  approved_at: nullableText,
  released_at: nullableText,
}).passthrough();

export const m5ScheduleListSchema = z.union([
  z.array(m5ScheduleSchema),
  z.object({ items: z.array(m5ScheduleSchema), total: z.number().optional() }),
]);

export const m5JobSchema = z.object({
  job_id: z.string(),
  status: z.string(),
}).passthrough();

export const m5ExecutionSummarySchema = z.object({
  plan_version: z.string(),
  event_count: z.number().int().nonnegative(),
  latest_event_at: z.string().nullable().optional(),
  average_start_deviation_minutes: z.number().nullable().optional(),
  average_end_deviation_minutes: z.number().nullable().optional(),
  max_abs_end_deviation_minutes: z.number().int().nullable().optional(),
  late_operation_count: z.number().int().nonnegative(),
  exception_count: z.number().int().nonnegative(),
  scrap_quantity: z.number().nonnegative(),
  planned_operation_count: z.number().int().nonnegative(),
  started_operation_count: z.number().int().nonnegative(),
  completed_operation_count: z.number().int().nonnegative(),
  paused_operation_count: z.number().int().nonnegative(),
  exception_operation_count: z.number().int().nonnegative(),
  completion_rate_percent: z.number().min(0).max(100).nullable(),
  source_event_counts: z.record(z.string(), z.number().int().nonnegative()),
}).passthrough();

const m5FlowStageStatusSchema = z.enum([
  'not_started',
  'queued',
  'running',
  'succeeded',
  'failed',
  'blocked',
]);

const m5FlowStageSchema = z.object({
  key: z.enum(['input', 'scheduling', 'validation', 'approval', 'dispatch', 'execution']),
  label: z.string(),
  status: m5FlowStageStatusSchema,
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  message: z.string(),
});

const m5FlowJobSchema = z.object({
  id: z.string(),
  job_type: z.string(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'dead_letter']),
  result_plan_version: z.string().nullable().optional(),
  persist_requested: z.boolean().nullable().optional(),
  matches_plan_version: z.boolean(),
  attempts: z.number().int().nonnegative(),
  max_attempts: z.number().int().positive(),
  error: z.string().nullable().optional(),
  created_at: z.string(),
  started_at: z.string().nullable().optional(),
  finished_at: z.string().nullable().optional(),
});

const m5FlowTrackingSchema = z.object({
  mode: z.enum(['off', 'shadow', 'strict']),
  tracking_task_id: z.string().nullable().optional(),
  event_count: z.number().int().nonnegative(),
  by_status: z.record(z.string(), z.number().int().nonnegative()),
  sent_count: z.number().int().nonnegative(),
  pending_count: z.number().int().nonnegative(),
  retry_count: z.number().int().nonnegative(),
  processing_count: z.number().int().nonnegative(),
  dead_letter_count: z.number().int().nonnegative(),
  latest_error: z.string().nullable().optional(),
  last_updated_at: z.string().nullable().optional(),
});

export const m5FlowDashboardItemSchema = z.object({
  plan_version: z.string(),
  parent_plan_version: z.string().nullable().optional(),
  tracking_task_id: z.string().nullable().optional(),
  overall_status: z.enum(['active', 'complete', 'attention']),
  progress_percent: z.number().int().min(0).max(100),
  input: z.object({
    scenario_id: z.string(),
    scenario_purpose: z.enum(['production', 'pressure_only']).optional(),
    received_at: z.string(),
    order_count: z.number().int().nonnegative(),
    orders: z.array(z.object({
      order_id: z.string(),
      product_id: z.string(),
      quantity: z.number(),
      unit: z.string(),
      due_time: z.string().nullable().optional(),
      priority: z.string().nullable().optional(),
      status: z.string().nullable().optional(),
      is_expedited: z.boolean(),
    })),
    routing_step_count: z.number().int().nonnegative(),
    resource_count: z.number().int().nonnegative(),
    material_availability_count: z.number().int().nonnegative(),
    bom_item_count: z.number().int().nonnegative(),
  }),
  output: z.object({
    plan_version: z.string(),
    solver_status: z.string(),
    validation_passed: z.boolean(),
    lifecycle_status: z.string(),
    scheduled_operation_count: z.number().int().nonnegative(),
    scheduled_order_count: z.number().int().nonnegative(),
    scheduled_resource_count: z.number().int().nonnegative(),
    operations: z.array(z.object({
      order_id: z.string(),
      product_id: z.string(),
      operation_id: z.string(),
      operation_name: z.string(),
      resource_id: z.string(),
      start_time: z.string(),
      end_time: z.string(),
      duration_minutes: z.number().int().nonnegative(),
      status: z.string(),
      source: z.string(),
    })).optional(),
    operations_truncated: z.boolean().optional(),
    resource_load_minutes: z.record(z.string(), z.number().int().nonnegative()).optional(),
    dispatch_count: z.number().int().nonnegative(),
    failed_dispatch_count: z.number().int().nonnegative(),
    dispatch_item_count: z.number().int().nonnegative(),
    dispatch_acknowledged_count: z.number().int().nonnegative(),
    dispatch_failed_count: z.number().int().nonnegative(),
    execution_event_count: z.number().int().nonnegative(),
    approved_at: z.string().nullable().optional(),
    released_at: z.string().nullable().optional(),
  }),
  stages: z.array(m5FlowStageSchema),
  jobs: z.array(m5FlowJobSchema),
  tracking: m5FlowTrackingSchema,
  updated_at: z.string(),
});

export const m5FlowDashboardSchema = z.array(m5FlowDashboardItemSchema);

export type M5Schedule = z.infer<typeof m5ScheduleSchema>;
export type M5ScheduleOperation = z.infer<typeof m5ScheduleOperationSchema>;
export type M5ExecutionSummary = z.infer<typeof m5ExecutionSummarySchema>;
export type M5PmcProgress = z.infer<typeof m5PmcProgressSchema>;
export type M5PmcProgressOperation = z.infer<typeof m5PmcProgressOperationSchema>;
export type M5FlowDashboardItem = z.infer<typeof m5FlowDashboardItemSchema>;
export type M5FlowStage = z.infer<typeof m5FlowStageSchema>;
