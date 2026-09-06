import {
  m4AlertPageSchema,
  m4AlertScanResultSchema,
  m4AlertSchema,
  m4AlertStatusUpdateSchema,
  m4ConfirmParseResultRequestSchema,
  m4GeneratePurchaseOrdersRequestSchema,
  m4ImportBatchSchema,
  m4PurchaseInquiryMessageRequestSchema,
  m4PurchaseInquiryMessageSchema,
  m4PurchaseOrderPageSchema,
  m4PurchaseOrderSchema,
  m4PurchaseOrderUpdateSchema,
  m4ReplyParseResultSchema,
  m4ReviewRequestSchema,
  m4SupplierCreateSchema,
  m4SupplierPageSchema,
  m4SupplierReplyCreateSchema,
  m4SupplierReplySchema,
  m4SupplierSchema,
  m4SupplierUpdateSchema,
  m4SuggestionPageSchema,
  m4TrackingPageSchema,
  m4UrgeMessageRequestSchema,
  m4UrgeMessageSchema,
  type M4Alert,
  type M4AlertStatus,
  type M4AlertType,
  type M4ImportBatch,
  type M4Page,
  type M4PurchaseInquiryMessage,
  type M4PurchaseOrder,
  type M4PurchaseOrderStatus,
  type M4ReplyParseResult,
  type M4Supplier,
  type M4SupplierReply,
  type M4SuggestionItem,
  type M4Tracking,
  type M4UrgeMessage,
} from '../schemas/m4';
import { withQuery } from './apiGateway';
import { requestJson, requestText } from './httpClient';

type PageParams = {
  page?: number;
  pageSize?: number;
};

type SupplierListParams = PageParams & {
  supplierName?: string;
};

type SuggestionListParams = PageParams & {
  batchId?: number;
  supplierName?: string;
  itemCode?: string;
  validationStatus?: string;
};

type PurchaseOrderListParams = PageParams & {
  status?: M4PurchaseOrderStatus | 'all';
  supplierName?: string;
};

type AlertListParams = PageParams & {
  status?: M4AlertStatus | 'all';
  alertType?: M4AlertType | 'all';
};

const toPageParams = (params: PageParams = {}) => ({
  page: params.page,
  page_size: params.pageSize,
});

export async function listM4Suppliers(params: SupplierListParams = {}): Promise<M4Page<M4Supplier>> {
  const payload = await requestJson<unknown>(
    withQuery('/m4/suppliers', {
      ...toPageParams(params),
      supplier_name: params.supplierName,
    }),
  );
  return m4SupplierPageSchema.parse(payload);
}

export async function createM4Supplier(payload: unknown): Promise<M4Supplier> {
  const response = await requestJson<unknown>('/m4/suppliers', {
    method: 'POST',
    body: m4SupplierCreateSchema.parse(payload),
  });
  return m4SupplierSchema.parse(response);
}

export async function updateM4Supplier(id: number, payload: unknown): Promise<M4Supplier> {
  const response = await requestJson<unknown>(`/m4/suppliers/${id}`, {
    method: 'PATCH',
    body: m4SupplierUpdateSchema.parse(payload),
  });
  return m4SupplierSchema.parse(response);
}

export async function uploadM4ImportBatch(file: File): Promise<M4ImportBatch> {
  const formData = new FormData();
  formData.append('file', file);

  const payload = await requestJson<unknown>('/m4/import-batches', {
    method: 'POST',
    body: formData,
  });

  return m4ImportBatchSchema.parse(payload);
}

export async function getM4ImportBatch(batchId: number): Promise<M4ImportBatch> {
  const payload = await requestJson<unknown>(`/m4/import-batches/${batchId}`);
  return m4ImportBatchSchema.parse(payload);
}

export async function importM4SuggestionsJson(payload: unknown): Promise<M4SuggestionItem[]> {
  const command =
    typeof payload === 'object' && payload !== null && 'suggestions' in payload
      ? payload
      : {
          suggestions:
            typeof payload === 'object' && payload !== null && 'items' in payload
              ? (payload as { items: unknown }).items
              : payload,
        };
  const response = await requestJson<unknown>('/m4/suggestions/import-json', {
    method: 'POST',
    body: command,
  });
  return m4ImportBatchSchema.parse(response).items;
}

export async function listM4Suggestions(params: SuggestionListParams = {}): Promise<M4Page<M4SuggestionItem>> {
  const payload = await requestJson<unknown>(
    withQuery('/m4/suggestions', {
      ...toPageParams(params),
      batch_id: params.batchId,
      supplier_name: params.supplierName,
      item_code: params.itemCode,
      validation_status: params.validationStatus,
    }),
  );
  return m4SuggestionPageSchema.parse(payload);
}

export async function generateM4PurchaseOrders(
  suggestionItemIds: number[],
  trackingTaskId?: string,
): Promise<M4PurchaseOrder[]> {
  const normalizedTaskId = trackingTaskId?.trim();
  const payload = await requestJson<unknown>('/m4/purchase-orders/generate', {
    method: 'POST',
    body: m4GeneratePurchaseOrdersRequestSchema.parse({ suggestion_item_ids: suggestionItemIds }),
    ...(normalizedTaskId ? { headers: { 'X-Yunpai-Task-ID': normalizedTaskId } } : {}),
  });
  return m4PurchaseOrderSchema.array().parse(payload);
}

export async function listM4PurchaseOrders(params: PurchaseOrderListParams = {}): Promise<M4Page<M4PurchaseOrder>> {
  const payload = await requestJson<unknown>(
    withQuery('/m4/purchase-orders', {
      ...toPageParams(params),
      status: params.status === 'all' ? undefined : params.status,
      supplier_name: params.supplierName,
    }),
  );
  return m4PurchaseOrderPageSchema.parse(payload);
}

export async function getM4PurchaseOrder(id: number): Promise<M4PurchaseOrder> {
  const payload = await requestJson<unknown>(`/m4/purchase-orders/${id}`);
  return m4PurchaseOrderSchema.parse(payload);
}

export async function updateM4PurchaseOrder(id: number, payload: unknown): Promise<M4PurchaseOrder> {
  const response = await requestJson<unknown>(`/m4/purchase-orders/${id}`, {
    method: 'PATCH',
    body: m4PurchaseOrderUpdateSchema.parse(payload),
  });
  return m4PurchaseOrderSchema.parse(response);
}

export async function submitM4PurchaseOrderReview(id: number, payload: unknown = {}): Promise<M4PurchaseOrder> {
  const response = await requestJson<unknown>(`/m4/purchase-orders/${id}/submit-review`, {
    method: 'POST',
    body: m4ReviewRequestSchema.parse(payload),
  });
  return m4PurchaseOrderSchema.parse(response);
}

export async function approveM4PurchaseOrder(id: number, payload: unknown = {}): Promise<M4PurchaseOrder> {
  const response = await requestJson<unknown>(`/m4/purchase-orders/${id}/approve`, {
    method: 'POST',
    body: m4ReviewRequestSchema.parse(payload),
  });
  return m4PurchaseOrderSchema.parse(response);
}

export async function rejectM4PurchaseOrder(id: number, payload: unknown = {}): Promise<M4PurchaseOrder> {
  const response = await requestJson<unknown>(`/m4/purchase-orders/${id}/reject`, {
    method: 'POST',
    body: m4ReviewRequestSchema.parse(payload),
  });
  return m4PurchaseOrderSchema.parse(response);
}

export async function generateM4PurchaseInquiryMessage(id: number, payload: unknown = {}): Promise<M4PurchaseInquiryMessage> {
  const response = await requestJson<unknown>(`/m4/purchase-orders/${id}/inquiry-message`, {
    method: 'POST',
    body: m4PurchaseInquiryMessageRequestSchema.parse(payload),
  });
  return m4PurchaseInquiryMessageSchema.parse(response);
}

export async function sendM4PurchaseOrder(id: number): Promise<M4PurchaseOrder> {
  const response = await requestJson<unknown>(`/m4/purchase-orders/${id}/send`, {
    method: 'POST',
    body: { record_only: true },
  });
  return m4PurchaseOrderSchema.parse(response);
}

export async function simulateM4SupplierConfirmation(
  id: number,
  payload: { promised_date: string; note?: string },
): Promise<M4PurchaseOrder> {
  const response = await requestJson<unknown>(`/m4/purchase-orders/${id}/simulate-confirm`, {
    method: 'POST',
    body: payload,
  });
  return m4PurchaseOrderSchema.parse(response);
}

export async function createM4SupplierReply(payload: unknown): Promise<M4SupplierReply> {
  const response = await requestJson<unknown>('/m4/replies', {
    method: 'POST',
    body: m4SupplierReplyCreateSchema.parse(payload),
  });
  return m4SupplierReplySchema.parse(response);
}

export async function parseM4SupplierReply(replyId: number): Promise<M4ReplyParseResult> {
  const payload = await requestJson<unknown>(`/m4/replies/${replyId}/parse`, {
    method: 'POST',
  });
  return m4ReplyParseResultSchema.parse(payload);
}

export async function confirmM4ReplyParse(replyId: number, payload: unknown): Promise<M4ReplyParseResult> {
  const response = await requestJson<unknown>(`/m4/replies/${replyId}/confirm`, {
    method: 'POST',
    body: m4ConfirmParseResultRequestSchema.parse(payload),
  });
  return m4ReplyParseResultSchema.parse(response);
}

export async function listM4Tracking(params: PageParams = {}): Promise<M4Page<M4Tracking>> {
  const payload = await requestJson<unknown>(
    withQuery('/m4/tracking', {
      ...toPageParams(params),
    }),
  );
  return m4TrackingPageSchema.parse(payload);
}

export function exportM4TrackingCsv() {
  return requestText('/m4/tracking/export.csv');
}

export async function scanM4Alerts() {
  const payload = await requestJson<unknown>('/m4/alerts/scan', {
    method: 'POST',
  });
  return m4AlertScanResultSchema.parse(payload);
}

export async function listM4Alerts(params: AlertListParams = {}): Promise<M4Page<M4Alert>> {
  const payload = await requestJson<unknown>(
    withQuery('/m4/alerts', {
      ...toPageParams(params),
      status: params.status === 'all' ? undefined : params.status,
      alert_type: params.alertType === 'all' ? undefined : params.alertType,
    }),
  );
  return m4AlertPageSchema.parse(payload);
}

export async function generateM4AlertUrgeMessage(id: number, payload: unknown = {}): Promise<M4UrgeMessage> {
  const response = await requestJson<unknown>(`/m4/alerts/${id}/urge-message`, {
    method: 'POST',
    body: m4UrgeMessageRequestSchema.parse(payload),
  });
  return m4UrgeMessageSchema.parse(response);
}

export function exportM4AlertsCsv() {
  return requestText('/m4/alerts/export.csv');
}

export async function updateM4AlertStatus(id: number, status: M4AlertStatus): Promise<M4Alert> {
  const response = await requestJson<unknown>(`/m4/alerts/${id}/status`, {
    method: 'POST',
    body: m4AlertStatusUpdateSchema.parse({ status }),
  });
  return m4AlertSchema.parse(response);
}
