import { z } from 'zod';

export const m8HealthSchema = z.object({ status: z.string() }).passthrough();
export const m8ProjectSchema = z.object({
  project_id: z.string(),
  status: z.string().optional(),
}).passthrough();
export const m8RunSchema = z.object({
  run_id: z.string(),
  status: z.string(),
}).passthrough();
export const m8OutputSchema = z.unknown();
export const m8CadContractSchema = z.object({ version: z.string().optional() }).passthrough();
export const m8CadRequestSchema = z.object({
  request_id: z.string().optional(),
  status: z.string().optional(),
}).passthrough();
