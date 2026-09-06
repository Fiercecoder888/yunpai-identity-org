import { z } from 'zod';

export const m6HealthSchema = z.object({ status: z.string() }).passthrough();
export const m6CostResultSchema = z.object({
  total_cost: z.union([z.string(), z.number()]).optional(),
}).passthrough();
export const m6BomImportResultSchema = z.object({
  import_id: z.string().optional(),
  status: z.string().optional(),
}).passthrough();
