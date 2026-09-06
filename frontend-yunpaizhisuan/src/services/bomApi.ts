import type { BomItem } from '../types/api';
import bomItemsFixture from '../mocks/fixtures/bomItems.json';
import { isNotImplementedResponse, requestJson } from './httpClient';

export type BomItemsResult = {
  items: BomItem[];
  source: 'api' | 'mock';
};

export type BomReviewResult = {
  item: BomItem;
  source: 'api' | 'mock';
};

let mockBomItems = (bomItemsFixture as BomItem[]).map((item) => ({ ...item }));

export async function getBomItems(): Promise<BomItemsResult> {
  try {
    const items = await requestJson<BomItem[]>('/demo/bom/items');
    return { items, source: 'api' };
  } catch (error) {
    if (!isNotImplementedResponse(error)) {
      throw error;
    }
    return { items: mockBomItems.map((item) => ({ ...item })), source: 'mock' };
  }
}

export async function reviewBomItem(id: string, status: 'approved' | 'rejected', reason?: string): Promise<BomReviewResult> {
  try {
    const item = await requestJson<BomItem>(`/demo/bom/items/${id}/review`, {
      method: 'POST',
      body: { status, reason },
    });
    return { item, source: 'api' };
  } catch (error) {
    if (!isNotImplementedResponse(error)) {
      throw error;
    }

    const current = mockBomItems.find((item) => item.id === id);
    if (!current) {
      throw error;
    }
    const updated = { ...current, status };
    mockBomItems = mockBomItems.map((item) => (item.id === id ? updated : item));
    return { item: updated, source: 'mock' };
  }
}
