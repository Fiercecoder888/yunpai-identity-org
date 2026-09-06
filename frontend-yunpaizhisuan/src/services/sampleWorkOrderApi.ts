import { z } from 'zod';
import { requestJson } from './httpClient';

export const sampleWorkOrderStatusSchema = z.enum([
  'created',
  'executing',
  'inspecting',
  'done',
  'rejected',
]);

export const sampleWorkOrderSchema = z
  .object({
    tenant_id: z.string(),
    order_id: z.string(),
    order_type: z.enum(['normal', 'pre_order', 'sample']).optional(),
    sample_group: z.string().nullable().optional(),
    product_name: z.string().nullable().optional(),
    qty: z.union([z.number(), z.string()]).nullable().optional(),
    status: sampleWorkOrderStatusSchema,
    reviewer: z.string().nullable().optional(),
    result: z.string().nullable().optional(),
    run_id: z.string().nullable().optional(),
    tracking_task_id: z.string().nullable().optional(),
    attributes: z.record(z.unknown()).optional(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .passthrough();

export type SampleWorkOrder = z.infer<typeof sampleWorkOrderSchema>;
export type SampleWorkOrderStatus = z.infer<typeof sampleWorkOrderStatusSchema>;

const sampleWorkOrderListSchema = z.object({
  tenant_id: z.string(),
  items: z.array(sampleWorkOrderSchema),
  total: z.number(),
});

export type SampleWorkOrderTransitionInput = {
  status?: SampleWorkOrderStatus;
  reviewer?: string;
  result?: string;
  sample_group?: string;
  remind?: boolean;
};

export async function listSampleWorkOrders(
  params: { status?: string; limit?: number; offset?: number } = {},
): Promise<z.infer<typeof sampleWorkOrderListSchema>> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.limit != null) query.set('limit', String(params.limit));
  if (params.offset != null) query.set('offset', String(params.offset));
  const suffix = query.toString();
  const raw = await requestJson<unknown>(
    `/orchestrator/sample-work-orders${suffix ? `?${suffix}` : ''}`,
  );
  return sampleWorkOrderListSchema.parse(raw);
}

export async function getSampleWorkOrder(orderId: string): Promise<SampleWorkOrder> {
  const raw = await requestJson<unknown>(
    `/orchestrator/sample-work-orders/${encodeURIComponent(orderId)}`,
  );
  return sampleWorkOrderSchema.parse(raw);
}

export async function transitionSampleWorkOrder(
  orderId: string,
  input: SampleWorkOrderTransitionInput,
): Promise<SampleWorkOrder> {
  const raw = await requestJson<unknown>(
    `/orchestrator/sample-work-orders/${encodeURIComponent(orderId)}/transition`,
    { method: 'POST', body: input },
  );
  return sampleWorkOrderSchema.parse(raw);
}
