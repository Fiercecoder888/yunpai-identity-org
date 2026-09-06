import { z } from 'zod';

const nullableText = z.string().nullish().transform((value) => value ?? undefined);

export const productionTeamSchema = z.object({
  team_id: z.string(),
  team_code: z.string(),
  team_name: z.string(),
  leader_user_id: z.string(),
  line_id: nullableText,
  resource_ids: z.array(z.string()).default([]),
  shift_rule: z.record(z.unknown()).default({}),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough();

export const teamMemberSchema = z.object({
  id: z.string(),
  team_id: z.string(),
  worker_id: z.string(),
  worker_name: z.string(),
  station: nullableText,
  role: z.string(),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough();

export const leaderTodayTaskSchema = z.object({
  plan_version: z.string(),
  tracking_task_id: z.string().nullish(),
  order_id: z.string(),
  product_id: z.string(),
  order_quantity: z.number().nullish(),
  operation_id: z.string(),
  operation_name: z.string(),
  resource_id: z.string(),
  resource_name: nullableText,
  start_time: z.string(),
  end_time: z.string(),
  planned_minutes: z.number().nullish(),
  schedule_status: z.string(),
  progress_state: z.string(),
  reported_quantity: z.number(),
  scrap_quantity: z.number(),
  ledger_entry_count: z.number(),
}).passthrough();

export const workloadLedgerSchema = z.object({
  id: z.string(),
  plan_version: nullableText,
  order_id: z.string(),
  operation_id: z.string(),
  operation_name: nullableText,
  resource_id: z.string(),
  resource_name: nullableText,
  product_id: nullableText,
  team_id: z.string(),
  team_name: nullableText,
  leader_user_id: z.string(),
  worker_id: z.string(),
  worker_name: nullableText,
  station: nullableText,
  execution_event_id: nullableText,
  fact_ref: nullableText,
  planned_min: z.number().nullish(),
  actual_min: z.number().nullish(),
  qty_reported: z.number(),
  qty_scrap: z.number(),
  shift_date: z.string(),
  status: z.string(),
  params: z.record(z.unknown()).default({}),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough();

export const workloadQuerySchema = z.object({
  items: z.array(workloadLedgerSchema).default([]),
  total: z.number(),
  total_planned_min: z.number(),
  total_actual_min: z.number(),
  total_qty_reported: z.number(),
  total_qty_scrap: z.number(),
  worker_count: z.number(),
}).passthrough();

export const workloadComparisonRowSchema = z.object({
  worker_id: z.string(),
  worker_name: nullableText,
  team_id: z.string(),
  order_count: z.number(),
  operation_count: z.number(),
  planned_min: z.number(),
  actual_min: z.number(),
  variance_min: z.number(),
  qty_reported: z.number(),
  qty_scrap: z.number(),
  completion_rate_percent: z.number().nullish(),
}).passthrough();

export const workloadComparisonSchema = z.object({
  items: z.array(workloadComparisonRowSchema).default([]),
  total_planned_min: z.number(),
  total_actual_min: z.number(),
  total_variance_min: z.number(),
  total_qty_reported: z.number(),
  total_qty_scrap: z.number(),
}).passthrough();

export type ProductionTeam = z.infer<typeof productionTeamSchema>;
export type TeamMember = z.infer<typeof teamMemberSchema>;
export type LeaderTodayTask = z.infer<typeof leaderTodayTaskSchema>;
export type WorkloadLedger = z.infer<typeof workloadLedgerSchema>;
export type WorkloadQuery = z.infer<typeof workloadQuerySchema>;
export type WorkloadComparisonRow = z.infer<typeof workloadComparisonRowSchema>;
export type WorkloadComparison = z.infer<typeof workloadComparisonSchema>;


export const workerOrderBindingSchema = z.object({
  id: z.string(),
  worker_id: z.string(),
  order_id: z.string(),
  team_id: nullableText,
  leader_user_id: nullableText,
  resource_id: nullableText,
  station: nullableText,
  role: z.string(),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough();

export const workerTaskSchema = z.object({
  binding_id: z.string(),
  worker_id: z.string(),
  team_id: z.string(),
  leader_user_id: z.string(),
  station: nullableText,
  plan_version: z.string(),
  tracking_task_id: nullableText,
  order_id: z.string(),
  product_id: z.string(),
  operation_id: z.string(),
  operation_name: z.string(),
  resource_id: z.string(),
  resource_name: nullableText,
  planned_start_time: z.string(),
  planned_end_time: z.string(),
  actual_status: z.enum([
    'not_started',
    'running',
    'paused',
    'exception',
    'scrapped',
    'completed',
  ]),
  unit: nullableText,
}).passthrough();

export type WorkerOrderBinding = z.infer<typeof workerOrderBindingSchema>;
export type WorkerTask = z.infer<typeof workerTaskSchema>;
