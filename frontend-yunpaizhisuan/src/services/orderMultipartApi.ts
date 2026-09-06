import {
  businessFlowCreatedSchema,
  type BusinessFlowCreateRequest,
  type BusinessFlowCreated,
} from './businessFlowRunApi';
import { uploadWithProgress } from './uploadWithProgress';

export type BusinessFlowMultipartOptions = {
  file?: Blob;
  filename?: string;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
};

const unwrapMultipartData = (raw: unknown): unknown => {
  if (raw && typeof raw === 'object' && 'success' in raw && 'data' in raw) {
    const envelope = raw as { success?: boolean; data?: unknown };
    return envelope.data ?? raw;
  }
  return raw;
};

/** 纯 multipart 表单构造器；独立可测，createBusinessFlowMultipart 直接复用。 */
export const buildBusinessFlowMultipartForm = (
  payload: BusinessFlowCreateRequest,
  options: Pick<BusinessFlowMultipartOptions, 'file' | 'filename'> = {},
): FormData => {
  const form = new FormData();
  form.append('idempotency_key', payload.idempotency_key);
  form.append('order_id', payload.order_id);
  if (payload.order_number) {
    form.append('order_number', payload.order_number);
  }
  form.append('mode', payload.mode);
  form.append('order_type', payload.order_type);
  form.append('m1_options', JSON.stringify(payload.m1_options ?? {}));
  form.append('m2_payload', JSON.stringify(payload.m2_payload ?? null));
  form.append('m3_payload', JSON.stringify(payload.m3_payload ?? null));
  form.append('m4_payload', JSON.stringify(payload.m4_payload ?? {}));
  form.append('m4_generate_payload', JSON.stringify(payload.m4_generate_payload ?? null));
  form.append('m5_payload', JSON.stringify(payload.m5_payload ?? null));
  form.append('replace_m3_bom_with_m2', String(payload.replace_m3_bom_with_m2));
  form.append('session_id', payload.session_id);
  if (options.file) {
    form.append('order_file', options.file, options.filename ?? 'order.bin');
  }
  return form;
};

/**
 * 订单业务流的 multipart 变体（后端解析 not run，仅前端契约预留）。
 *
 * 与 createBusinessFlow 签名兼容，返回同构 BusinessFlowCreated；
 * 文件走 FormData 的 order_file 字段，规避 base64 放大后的 100MB 上限。
 * 透传 X-Yunpai-Task-ID 与 idempotency_key（表单字段），供网关/编排器复用
 * 既有 TaskID 传播与幂等语义。
 */
export async function createBusinessFlowMultipart(
  payload: BusinessFlowCreateRequest,
  trackingTaskId: string,
  options: BusinessFlowMultipartOptions = {},
): Promise<BusinessFlowCreated> {
  const form = buildBusinessFlowMultipartForm(payload, options);

  const result = await uploadWithProgress('/orchestrator/business-flows', form, {
    method: 'POST',
    headers: { 'X-Yunpai-Task-ID': trackingTaskId },
    signal: options.signal,
    onProgress: options.onProgress,
  });
  return businessFlowCreatedSchema.parse(unwrapMultipartData(result.data));
}
