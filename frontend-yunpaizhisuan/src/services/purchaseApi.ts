import type { PurchaseWarning } from '../types/api';
import { requestJson } from './httpClient';

export function getPurchaseWarnings() {
  return requestJson<PurchaseWarning[]>('/demo/purchase/warnings');
}

export function followPurchaseWarning(id: string) {
  return requestJson<PurchaseWarning>(`/demo/purchase/warnings/${id}/follow`, {
    method: 'POST',
  });
}
