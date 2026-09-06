import { withQuery } from './apiGateway';
import { requestJson } from './httpClient';


export type JsonRecord = Record<string, unknown>;

export function getBusinessOrderTrace(orderId: string) {
  return requestJson<JsonRecord>(
    `/orchestrator/business-orders/${encodeURIComponent(orderId)}/trace`,
  );
}

export function getBusinessFlowTrace(runId: string) {
  return requestJson<JsonRecord>(`/orchestrator/business-flows/${runId}/trace`);
}

export function getBusinessMaterialTrace(materialId: string) {
  return requestJson<JsonRecord>(
    `/orchestrator/business-materials/${encodeURIComponent(materialId)}/trace`,
  );
}

export function getBusinessCostVariance(period: string) {
  return requestJson<JsonRecord>(
    withQuery('/orchestrator/business-cost-variance', { period }),
  );
}

export function getBusinessFinishedGoods() {
  return requestJson<JsonRecord>('/orchestrator/business-finished-goods');
}

export function getBusinessConsumptionVariance(params: {
  orderId?: string;
  materialCode?: string;
  reason?: string;
  limit?: number;
  offset?: number;
} = {}) {
  const query: Record<string, string | number> = {};
  if (params.orderId) query.order_id = params.orderId;
  if (params.materialCode) query.material_code = params.materialCode;
  if (params.reason) query.reason = params.reason;
  if (params.limit != null) query.limit = params.limit;
  if (params.offset != null) query.offset = params.offset;
  return requestJson<JsonRecord>(
    withQuery('/orchestrator/business-consumption-variance', query),
  );
}

export function refreshBusinessConsumptionVariance(orderId?: string) {
  return requestJson<JsonRecord>('/orchestrator/business-consumption-variance/refresh', {
    method: 'POST',
    body: orderId ? { order_id: orderId } : {},
  });
}

export function getBusinessOrderOutboundFlow(orderId: string) {
  return requestJson<JsonRecord>(
    `/orchestrator/business-orders/${encodeURIComponent(orderId)}/outbound-flow`,
  );
}

export function getBusinessFlowOutboundFlow(runId: string) {
  return requestJson<JsonRecord>(
    `/orchestrator/business-flows/${encodeURIComponent(runId)}/outbound-flow`,
  );
}

export function inspectFinishedGoods(params: {
  materialId: string;
  orderId?: string;
  quantity: number;
  result?: 'pass' | 'fail';
  locationId?: string;
}) {
  const materialId = params.materialId;
  const stamp = `${Date.now()}`;
  return requestJson<JsonRecord>('/orchestrator/business-facts', {
    method: 'POST',
    body: {
      fact_type: 'inspection',
      aggregate_type: 'material',
      aggregate_id: materialId,
      source_module: 'm5',
      source_event_id: `inspect-${materialId}-${stamp}`,
      occurred_at: new Date().toISOString(),
      payload: {
        material_id: materialId,
        order_id: params.orderId ?? '',
        location_id: params.locationId ?? 'FG-WH',
        inspection_id: `INSP-${materialId}-${stamp}`,
        quantity: String(params.quantity),
        result: params.result ?? 'pass',
        source: 'production_output',
      },
      auto_recalculate: false,
    },
  });
}

export function publishBusinessFact(payload: JsonRecord) {
  return requestJson<JsonRecord>('/orchestrator/business-facts', {
    method: 'POST',
    body: payload,
  });
}

export function publishExecutionOutput(payload: JsonRecord) {
  return requestJson<JsonRecord>('/orchestrator/business-execution-outputs', {
    method: 'POST',
    body: payload,
  });
}
