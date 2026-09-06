import type { SopStep } from '../types/api';
import sopStepsFixture from '../mocks/fixtures/sopSteps.json';
import { isNotImplementedResponse, requestJson } from './httpClient';

export type SopStepsResult = {
  items: SopStep[];
  source: 'api' | 'mock';
};

export async function getSopSteps(): Promise<SopStepsResult> {
  try {
    const items = await requestJson<SopStep[]>('/demo/sop/steps');
    return { items, source: 'api' };
  } catch (error) {
    if (!isNotImplementedResponse(error)) {
      throw error;
    }
    return { items: (sopStepsFixture as SopStep[]).map((item) => ({ ...item })), source: 'mock' };
  }
}
