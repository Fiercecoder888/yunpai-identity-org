import { z } from 'zod';

export const auditLogSchema = z.object({
  id: z.string(),
  time: z.string(),
  actor: z.string(),
  action: z.string(),
  module: z.string(),
  targetId: z.string(),
  result: z.enum(['success', 'failed', 'blocked']),
  detail: z.string(),
});

export const auditLogListSchema = z.array(auditLogSchema);

export type AuditLog = z.infer<typeof auditLogSchema>;
