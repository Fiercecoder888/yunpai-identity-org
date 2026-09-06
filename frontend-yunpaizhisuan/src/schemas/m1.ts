import { z } from 'zod';

export const m1TaskStatusSchema = z.enum(['pending', 'running', 'need_review', 'completed', 'failed', 'cancelled']);

export const m1MetadataSchema = z.object({
  source: z.enum(['manual', 'email', 'erp', 'archive']),
  customerId: z.string().optional(),
  orderId: z.string().optional(),
  projectId: z.string().optional(),
  documentType: z.enum(['drawing', 'contract', 'bom', 'sop', 'other']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  operatorNote: z.string().max(500).optional(),
});

export const m1ReviewSubmitSchema = z.object({
  correctedValue: z.string(),
  reason: z.string().min(1).max(500),
});

export type M1Metadata = z.infer<typeof m1MetadataSchema>;
export type M1ReviewSubmit = z.infer<typeof m1ReviewSubmitSchema>;
