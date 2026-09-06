import { m6BomImportResultSchema, m6CostResultSchema, m6HealthSchema } from '../schemas/m6';
import { unwrapEnvelope } from './apiResponse';
import { requestJson } from './httpClient';
import type { z } from 'zod';

const parseEnvelope = <T>(payload: unknown, schema: z.ZodType<T>) => schema.parse(unwrapEnvelope<unknown>(payload));

export function getM6Health() {
  return requestJson<unknown>('/m6/health').then((response) => parseEnvelope(response, m6HealthSchema));
}

export function calculateM6FinanceCost(payload: unknown) {
  return requestJson<unknown>('/m6/finance/cost', { method: 'POST', body: payload }).then((response) =>
    parseEnvelope(response, m6CostResultSchema),
  );
}

export function importM6FinanceBom(payload: unknown) {
  return requestJson<unknown>('/m6/finance/bom/import', { method: 'POST', body: payload }).then((response) =>
    parseEnvelope(response, m6BomImportResultSchema),
  );
}
