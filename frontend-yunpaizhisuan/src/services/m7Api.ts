import { withQuery } from './apiGateway';
import { unwrapEnvelope } from './apiResponse';
import { HttpClientError, requestJson } from './httpClient';
import { getJob, invokeAgent } from './orchestratorApi';

export type M7DeliveryNote = {
  delivery_note_id: string;
  delivery_note_number: string;
  supplier_id: string;
  purchase_order_id: string;
  order_id: string;
  dedicated_order_id?: string | null;
  warehouse_id: string;
  status: string;
  tracking_task_id: string;
  items: Array<Record<string, string>>;
};

export type M7InspectionLot = {
  inspection_lot_id: string;
  delivery_note_id: string;
  material_code: string;
  batch_no: string;
  lot_quantity: string;
  recommended_sample_quantity: string;
  sampling_rule: string;
  status: string;
  tracking_task_id: string;
};

export type M7InventoryBalance = {
  inventory_balance_id: string;
  warehouse_id: string;
  material_id: string;
  material_code: string;
  batch_no: string;
  uom: string;
  quantity_on_hand: string;
  quantity_available: string;
  quantity_blocked: string;
  quantity_reserved: string;
  allocations?: M7InventoryAllocation[];
};

export type M7InventoryAllocation = {
  allocation_id: string;
  inventory_balance_id: string;
  warehouse_id: string;
  material_id: string;
  material_code: string;
  batch_no: string;
  uom: string;
  order_id: string;
  quantity_allocated: string;
  quantity_consumed: string;
  quantity_remaining: string;
  status: string;
  tracking_task_id: string;
};

export type M7MaterialIssue = {
  material_issue_id: string;
  issue_number: string;
  order_id: string;
  issue_type: string;
  status: string;
  tracking_task_id: string;
  requested_by: string;
  items: Array<Record<string, string | boolean>>;
};

type DeliveryInput = Omit<M7DeliveryNote, 'delivery_note_id' | 'status' | 'tracking_task_id'> & {
  supplier_delivery_number: string;
  idempotency_key: string;
  source_document_id?: string;
};

export type M7DeliveryScan = {
  m0_batch_id: string;
  suggested: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
  missing_fields: string[];
  warnings: string[];
  recognized_document_types: string[];
  reference_fields: Record<string, unknown>;
  source_documents: Array<Record<string, unknown>>;
  requires_human_review: boolean;
};

type IssueInput = {
  issue_number: string;
  order_id: string;
  purpose: string;
  idempotency_key: string;
  items: Array<Record<string, string | number | boolean>>;
  reason_code?: string;
  reason?: string;
};

export type M7OrderMaterialRequirementInput = {
  order_id: string;
  material_id: string;
  material_code: string;
  standard_required_quantity: number;
  loss_rate: number;
  uom: string;
  source_version_id: string;
};

export const createM7TrackingTaskId = () => {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `task_m7_${random}`;
};

const trackingHeaders = (taskId: string) => ({ 'X-Yunpai-Task-ID': taskId });

async function createM7RootTask(businessType: string, businessId?: string): Promise<string> {
  const proposedTaskId = createM7TrackingTaskId();
  try {
    const created = await requestJson<{ task_id: string }>('/orchestrator/tracking/tasks', {
      method: 'POST',
      body: {
        task_id: proposedTaskId,
        business_type: businessType,
        business_id: businessId,
        created_by_module: 'frontend',
        metadata: { entrypoint: 'm7-assistant-panel' },
      },
    });
    return created.task_id;
  } catch (error) {
    // TRACKING_MODE=off is the repository default. Business operations still
    // receive and persist an opaque TaskID; shadow mode registers it first.
    if (error instanceof HttpClientError && error.error.status === 503) return proposedTaskId;
    throw error;
  }
}

export async function listM7DeliveryNotes(status?: string): Promise<M7DeliveryNote[]> {
  const response = await requestJson<unknown>(withQuery('/m7/delivery-notes', { status }), { headers: trackingHeaders(createM7TrackingTaskId()) });
  return unwrapEnvelope<unknown>(response) as M7DeliveryNote[];
}

export async function createM7DeliveryNote(payload: DeliveryInput, taskId?: string): Promise<M7DeliveryNote> {
  const resolvedTaskId = taskId ?? await createM7RootTask('m7_delivery_receipt', payload.delivery_note_number);
  const response = await requestJson<unknown>('/m7/delivery-notes', { method: 'POST', headers: trackingHeaders(resolvedTaskId), body: payload });
  return unwrapEnvelope<unknown>(response) as M7DeliveryNote;
}

export async function scanM7DeliveryNote(m0BatchId: string, taskId = createM7TrackingTaskId()): Promise<M7DeliveryScan> {
  const response = await requestJson<unknown>('/m7/delivery-notes/scan', {
    method: 'POST', headers: trackingHeaders(taskId), body: { m0_batch_id: m0BatchId },
  });
  return unwrapEnvelope<unknown>(response) as M7DeliveryScan;
}

export async function signM7DeliveryNote(note: M7DeliveryNote, signatureReference: string): Promise<M7DeliveryNote> {
  const response = await requestJson<unknown>(`/m7/delivery-notes/${note.delivery_note_id}/sign`, {
    method: 'PUT', headers: trackingHeaders(note.tracking_task_id), body: { signature_reference: signatureReference },
  });
  return unwrapEnvelope<unknown>(response) as M7DeliveryNote;
}

export async function listM7PendingInspections(): Promise<M7InspectionLot[]> {
  const response = await requestJson<unknown>('/m7/qc-pending', { headers: trackingHeaders(createM7TrackingTaskId()) });
  return unwrapEnvelope<unknown>(response) as M7InspectionLot[];
}

export async function sampleM7Inspection(lot: M7InspectionLot, sampleQuantity: number, nonconformingQuantity: number, reason?: string): Promise<M7InspectionLot> {
  const response = await requestJson<unknown>(`/m7/inspection-lots/${lot.inspection_lot_id}/sample`, {
    method: 'POST', headers: trackingHeaders(lot.tracking_task_id),
    body: { sample_quantity: sampleQuantity, nonconforming_quantity: nonconformingQuantity, reason },
  });
  return unwrapEnvelope<unknown>(response) as M7InspectionLot;
}

export async function confirmM7Inspection(lot: M7InspectionLot, result: 'passed' | 'rejected', decisionComment: string): Promise<M7InspectionLot> {
  const response = await requestJson<unknown>(`/m7/inspection-lots/${lot.inspection_lot_id}/confirm`, {
    method: 'POST', headers: trackingHeaders(lot.tracking_task_id), body: { result, decision_comment: decisionComment },
  });
  return unwrapEnvelope<unknown>(response) as M7InspectionLot;
}

export async function queryM7Inventory(materialCode?: string): Promise<M7InventoryBalance[]> {
  const response = await requestJson<unknown>(withQuery('/m7/inventory', { material_code: materialCode }), { headers: trackingHeaders(createM7TrackingTaskId()) });
  return unwrapEnvelope<unknown>(response) as M7InventoryBalance[];
}

export async function allocateM7InventoryToOrder(payload: {
  warehouse_id: string;
  material_id: string;
  material_code: string;
  batch_no: string;
  quantity: number;
  uom: string;
  order_id: string;
  idempotency_key: string;
}): Promise<M7InventoryAllocation> {
  const response = await requestJson<unknown>('/m7/inventory/allocations', {
    method: 'POST', headers: trackingHeaders(createM7TrackingTaskId()), body: payload,
  });
  return unwrapEnvelope<unknown>(response) as M7InventoryAllocation;
}

export async function releaseM7InventoryAllocation(allocation: M7InventoryAllocation): Promise<M7InventoryAllocation> {
  const response = await requestJson<unknown>(`/m7/inventory/allocations/${allocation.allocation_id}/release`, {
    method: 'PUT', headers: trackingHeaders(allocation.tracking_task_id),
  });
  return unwrapEnvelope<unknown>(response) as M7InventoryAllocation;
}

async function submitM7MaterialIssue(payload: IssueInput, over: boolean, taskId?: string): Promise<M7MaterialIssue> {
  const resolvedTaskId = taskId ?? await createM7RootTask(over ? 'm7_over_issue' : 'm7_material_issue', payload.issue_number);
  const response = await requestJson<unknown>(over ? '/m7/material-issues/over' : '/m7/material-issues', {
    method: 'POST', headers: trackingHeaders(resolvedTaskId), body: payload,
  });
  return unwrapEnvelope<unknown>(response) as M7MaterialIssue;
}

export async function createM7MaterialIssue(payload: IssueInput, taskId?: string): Promise<M7MaterialIssue> {
  return submitM7MaterialIssue(payload, false, taskId);
}

export async function createM7OverIssue(payload: IssueInput, taskId?: string): Promise<M7MaterialIssue> {
  return submitM7MaterialIssue(payload, true, taskId);
}

export async function listM7MaterialIssues(orderId?: string): Promise<M7MaterialIssue[]> {
  const response = await requestJson<unknown>(withQuery('/m7/material-issues', { order_id: orderId }), { headers: trackingHeaders(createM7TrackingTaskId()) });
  return unwrapEnvelope<unknown>(response) as M7MaterialIssue[];
}

export async function upsertM7OrderMaterialRequirement(
  payload: M7OrderMaterialRequirementInput,
): Promise<void> {
  const toolName = 'upsert_m7_order_material_requirement';
  const submitted = await invokeAgent({
    task: `登记订单 ${payload.order_id} 的受控物料标准用量`,
    tools: [toolName],
    tool_payloads: {
      [toolName]: {
        ...payload,
        idempotency_key: `requirement:${payload.order_id}:${payload.material_id}:${payload.source_version_id}`,
      },
    },
    use_memory: false,
    stop_on_failure: true,
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const job = await getJob(submitted.job_id);
    if (job.status === 'done') return;
    if (job.status === 'failed' || job.status === 'partial' || job.status === 'cancelled') {
      throw new Error(job.error || job.steps.find((step) => step.error)?.error || '订单标准用量登记失败');
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 250));
  }
  throw new Error('订单标准用量登记超时，请查询编排作业状态后重试');
}

export async function approveM7OverIssue(issue: M7MaterialIssue, decisionComment: string): Promise<M7MaterialIssue> {
  const response = await requestJson<unknown>(`/m7/material-issues/${issue.material_issue_id}/approve`, {
    method: 'PUT', headers: trackingHeaders(issue.tracking_task_id), body: { decision_comment: decisionComment },
  });
  return unwrapEnvelope<unknown>(response) as M7MaterialIssue;
}
