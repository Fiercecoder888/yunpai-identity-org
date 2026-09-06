/**
 * R7 工程文档绑定与预览 API（T7）。
 *
 * 独立于 m0Api.ts（T8 提取结果展示会共用 m0Api），本文件只负责
 * 已入库文档的绑定 / 按实体查询 / 文件流预览 / 类型修正。
 */

import { unwrapEnvelope } from './apiResponse';
import { requestBlob, requestJson } from './httpClient';
import { toApiUrl, withQuery } from './apiGateway';

export type M0EntityType = 'material' | 'product' | 'order';

export type M0MasterDocument = {
  id: number;
  batch_id: string;
  domain: string;
  doc_type: string;
  doc_no: string;
  title: string;
  content_text: string;
  stored_name: string;
  status: string;
  created_at: string;
};

export type M0DocumentBinding = {
  id: number;
  doc_id: number;
  entity_type: M0EntityType;
  entity_id: string;
  entity_code: string;
  entity_name: string;
  stage: string;
  created_by: string;
  created_at: string;
};

export type M0DocumentWithBindings = M0MasterDocument & {
  bindings: M0DocumentBinding[];
};

export type M0DocumentBindingInput = {
  entity_type: M0EntityType;
  entity_id: string;
  entity_code?: string;
  entity_name?: string;
  stage?: string;
};

export const DOC_TYPE_OPTIONS = [
  { value: 'engineering_drawing', label: '工程图' },
  { value: 'process_method', label: '工艺方法' },
  { value: 'packing_method', label: '包装方法' },
  { value: 'test_method', label: '测试方法' },
];

export const ENTITY_TYPE_OPTIONS = [
  { value: 'material' as const, label: '物料' },
  { value: 'product' as const, label: '产品' },
  { value: 'order' as const, label: '订单' },
];

export const docTypeLabel = (value: string | undefined) =>
  DOC_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? (value || '未设置');

export const entityTypeLabel = (value: string | undefined) =>
  ENTITY_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value ?? '';

export type M0DocumentQuery = {
  material?: string;
  product?: string;
  order?: string;
  doc_type?: string;
  limit?: number;
};

export function listM0Documents(params: M0DocumentQuery = {}) {
  return requestJson<unknown>(withQuery('/m0/documents', params)).then((response) =>
    unwrapEnvelope<{ documents: M0DocumentWithBindings[] }>(response),
  );
}

export function listM0DocumentBindings(docId: number) {
  return requestJson<unknown>(`/m0/documents/${docId}/bindings`).then((response) =>
    unwrapEnvelope<{ document: M0MasterDocument; bindings: M0DocumentBinding[] }>(response),
  );
}

export function bindM0Document(docId: number, bindings: M0DocumentBindingInput[]) {
  return requestJson<unknown>(`/m0/documents/${docId}/bindings`, {
    method: 'POST',
    body: { bindings },
  }).then((response) => unwrapEnvelope<{ bindings: M0DocumentBinding[] }>(response));
}

export function deleteM0DocumentBinding(bindingId: number) {
  return requestJson<unknown>(`/m0/documents/bindings/${bindingId}`, {
    method: 'DELETE',
  }).then((response) => unwrapEnvelope<{ deleted: number }>(response));
}

export function updateM0DocumentDocType(docId: number, docType: string) {
  return requestJson<unknown>(`/m0/documents/${docId}/doc_type`, {
    method: 'POST',
    body: { doc_type: docType },
  }).then((response) => unwrapEnvelope<{ document: M0MasterDocument }>(response));
}

export function m0DocumentFileUrl(docId: number) {
  return toApiUrl(`/m0/documents/${docId}/file`);
}

export function getM0DocumentFile(docId: number) {
  return requestBlob(`/m0/documents/${docId}/file`);
}
