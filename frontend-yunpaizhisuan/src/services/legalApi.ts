import { isMswDemoMode } from '../app/runtimeMode';
import type { LegalRisk } from '../types/api';
import { HttpClientError, requestJson } from './httpClient';

const notImplementedError = () =>
  new HttpClientError({
    code: 'not_implemented',
    message: '法务模块未交付，真实后端模式不可用',
    detail: { module: 'M7' },
  });

export function getLegalRisks() {
  if (!isMswDemoMode()) {
    return Promise.reject(notImplementedError());
  }
  return requestJson<LegalRisk[]>('/demo/legal/risks');
}

export function submitLegalFinalReview(id: string, status: 'approved' | 'rejected' | 'escalated', opinion: string) {
  if (!isMswDemoMode()) {
    return Promise.reject(notImplementedError());
  }
  return requestJson<LegalRisk>(`/demo/legal/risks/${id}/final-review`, {
    method: 'POST',
    body: { status, opinion },
  });
}
