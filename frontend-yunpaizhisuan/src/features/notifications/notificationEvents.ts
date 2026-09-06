import { z } from 'zod';

/**
 * SSE 通知事件 schema（预留）。
 * 后端 SSE 端点未交付；前端仅声明事件协议并支持 EventSource + 轮询降级。
 * 事件类型后续扩展时保持 discriminated union 向后兼容。
 */
export const notificationEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('business'),
    id: z.string().min(1),
    title: z.string(),
    message: z.string(),
    module: z.string().optional(),
    severity: z.enum(['info', 'warning', 'error']).default('info'),
    createdAt: z.string().optional(),
  }),
  z.object({
    type: z.literal('run_status'),
    id: z.string().min(1),
    runId: z.string().optional(),
    taskId: z.string().optional(),
    status: z.string(),
    message: z.string(),
    createdAt: z.string().optional(),
  }),
  z.object({
    type: z.literal('ping'),
    id: z.string().min(1),
    createdAt: z.string().optional(),
  }),
]);

export type NotificationEvent = z.infer<typeof notificationEventSchema>;

export const parseNotificationEvent = (raw: unknown): NotificationEvent | null => {
  const result = notificationEventSchema.safeParse(raw);
  return result.success ? result.data : null;
};
