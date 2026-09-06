import { z } from 'zod';

export const orchestratorJobStatusSchema = z.enum(['queued', 'running', 'done', 'partial', 'failed', 'cancelled']);

export const orchestratorStepSchema = z.object({
  id: z.string().optional(),
  tool: z.string().optional(),
  name: z.string().optional(),
  module: z.string().optional(),
  status: orchestratorJobStatusSchema.or(z.enum(['ok', 'waiting_human', 'success', 'idle'])),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  duration_ms: z.number().optional(),
  trace_id: z.string().optional(),
  started_at: z.string().optional(),
  finished_at: z.string().optional(),
}).passthrough();

const orchestratorInvokeResponseRawSchema = z.object({
  job_id: z.string(),
  status: orchestratorJobStatusSchema,
  tools: z.array(z.string()).optional(),
  tools_to_use: z.array(z.string()).optional(),
  session_id: z.string().nullable().optional(),
}).passthrough();

const normalizeTools = <T extends { tools?: string[]; tools_to_use?: string[] }>(value: T) => ({
  ...value,
  tools: value.tools ?? value.tools_to_use ?? [],
  tools_to_use: value.tools_to_use ?? value.tools ?? [],
});

export const orchestratorInvokeResponseSchema = orchestratorInvokeResponseRawSchema.transform(normalizeTools);

export const orchestratorJobSchema = orchestratorInvokeResponseRawSchema.extend({
  steps: z.array(orchestratorStepSchema).default([]),
  current_step: orchestratorStepSchema.nullable().optional(),
  stop_on_failure: z.boolean().optional(),
  result: z.unknown().optional(),
  error: z.string().nullable().optional(),
}).passthrough().transform(normalizeTools);

export const orchestratorJobListSchema = z.union([
  z.array(orchestratorJobSchema),
  z.object({
    items: z.array(orchestratorJobSchema),
    total: z.number().optional(),
  }),
]);

export const orchestratorHealthSchema = z.object({
  status: z.string(),
}).passthrough();

export const orchestratorMemoryResultSchema = z.object({
  items: z.array(z.unknown()).default([]),
}).passthrough();

export type OrchestratorInvokeResponse = z.infer<typeof orchestratorInvokeResponseSchema>;
export type OrchestratorJob = z.infer<typeof orchestratorJobSchema>;
export type OrchestratorStep = z.infer<typeof orchestratorStepSchema>;
