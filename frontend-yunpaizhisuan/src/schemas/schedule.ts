import { z } from 'zod';

export const scheduleStatusSchema = z.enum(['draft', 'solving', 'solved', 'conflict', 'adjusted', 'published']);

export const scheduleTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  resourceId: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  status: scheduleStatusSchema,
});

export const scheduleAdjustmentSchema = z.object({
  taskId: z.string(),
  planVersion: z.string().optional(),
  orderId: z.string().optional(),
  operationId: z.string().optional(),
  startAt: z.string(),
  endAt: z.string(),
  reason: z.string().min(1),
});

/** 计划事件（B2R-E1 只读查询接口返回；写入仍走业务路由，此处不承载写语义）。 */
export const scheduleEventSchema = z.object({
  id: z.string(),
  sequence: z.number().int().nullable().optional(),
  base_plan_version: z.string(),
  new_plan_version: z.string().nullable().optional(),
  event_type: z.string(),
  source: z.string(),
  occurred_at: z.string(),
  severity: z.string(),
  reason: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
  created_at: z.string(),
});

export type ScheduleTask = z.infer<typeof scheduleTaskSchema>;
export type ScheduleAdjustment = z.infer<typeof scheduleAdjustmentSchema>;
export type ScheduleEvent = z.infer<typeof scheduleEventSchema>;
