import { z } from 'zod';

export const agentNodeStatusSchema = z.enum(['idle', 'running', 'success', 'failed', 'waiting_human']);

export const flowNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  module: z.string(),
  status: agentNodeStatusSchema,
  implementation: z.enum(['real', 'hybrid', 'mock']).optional(),
  summary: z.string().optional(),
  input: z.string().optional(),
  output: z.string().optional(),
});

export const flowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
});

export const flowGraphSchema = z.object({
  nodes: z.array(flowNodeSchema),
  edges: z.array(flowEdgeSchema),
});

export type FlowGraph = z.infer<typeof flowGraphSchema>;
