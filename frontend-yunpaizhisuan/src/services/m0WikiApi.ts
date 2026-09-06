import { requestJson } from './httpClient';
import { unwrapEnvelope } from './apiResponse';
import { withQuery } from './apiGateway';
import { createM0TrackingTaskId } from './m0Api';

/**
 * M0 Wiki knowledge and governed entity-management client.
 */

export const M0_WIKI_ENTITY_TYPES = [
  'product',
  'product_family',
  'order',
  'bom',
  'document',
  'material',
  'supplier',
  'equipment',
  'process_route',
  'operation',
  'tooling',
] as const;

export type M0WikiEntityType = (typeof M0_WIKI_ENTITY_TYPES)[number];

export type M0WikiEntitySnapshot = {
  entity_id?: string;
  version_row_id?: string;
  entity_type?: M0WikiEntityType | string;
  business_key?: string;
  label?: string;
  version_id?: string;
  status?: string;
  attributes?: Record<string, unknown>;
  review_status?: string;
  reviewed_by?: string;
  recorded_from?: string;
  sources?: Array<Record<string, unknown>>;
  relations?: Array<Record<string, unknown>>;
};

export type M0WikiIndexEntry = {
  entity_id?: string;
  business_key?: string;
  label?: string;
  version_id?: string;
  status?: string;
  role?: string;
  recorded_at?: string;
};

export type M0WikiHistoryEntry = {
  version_id?: string;
  recorded_from?: string;
  recorded_to?: string | null;
  status?: string;
  review_status?: string;
};

export type M0WikiGraph = {
  nodes?: Array<Record<string, unknown> & { entity_id?: string; label?: string; entity_type?: string }>;
  edges?: Array<Record<string, unknown> & { relation_type?: string; source_entity_id?: string; target_entity_id?: string }>;
};

export type M0WikiProduct = {
  product: M0WikiEntitySnapshot;
  indexes: Record<string, M0WikiIndexEntry[]>;
  families: M0WikiIndexEntry[];
  same_family_products: M0WikiIndexEntry[];
  routes: Array<Record<string, unknown>>;
  graph: M0WikiGraph;
  history: M0WikiHistoryEntry[];
  as_of?: string | null;
  summary: Record<string, number | string | null>;
};

export type M0WikiBomLines = {
  bom: string;
  revision: string;
  lines: Array<Record<string, unknown>>;
};

export type M0WikiBomDiff = {
  bom?: string;
  base_revision?: string;
  target_revision?: string;
  added?: Array<Record<string, unknown>>;
  removed?: Array<Record<string, unknown>>;
  changed?: Array<Record<string, unknown>>;
} & Record<string, unknown>;

export type M0WikiMaterial = {
  material: M0WikiEntitySnapshot;
  summary: Record<string, number | string>;
  used_in?: Array<Record<string, unknown>>;
  used_in_routes?: Array<Record<string, unknown>>;
  suppliers?: Array<Record<string, unknown>>;
  history: M0WikiHistoryEntry[];
} & Record<string, unknown>;

export type M0WikiEquipment = {
  entity: M0WikiEntitySnapshot;
  summary: Record<string, number | string>;
  history: M0WikiHistoryEntry[];
} & Record<string, unknown>;

export type M0SearchResultItem = {
  entity_id?: string;
  search_document_id?: string;
  entity_type?: string;
  business_key?: string;
  label?: string;
  title?: string;
  score?: number;
  match_reasons?: string[];
};

export type M0WikiEntityDetail = {
  entity: M0WikiEntitySnapshot;
  history: M0WikiHistoryEntry[];
  lines: Array<Record<string, unknown>>;
  summary: Record<string, number>;
};

export type M0WikiEntityMutationInput = {
  entityType: M0WikiEntityType;
  businessKey: string;
  versionId?: string;
  payload: Record<string, unknown>;
  relations?: Array<Record<string, unknown>>;
  expectedVersionRowId?: string;
  reason?: string;
};

export type M0WikiMutationOptions = {
  trackingTaskId?: string;
  mutationId?: string;
};

export type M0WikiMutationResult = {
  action: 'create' | 'update' | 'delete';
  entity: M0WikiEntitySnapshot;
  publication: Record<string, unknown>;
};

const createMutationId = () => {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `wiki_${suffix}`;
};

const mutationRequest = (
  input: M0WikiEntityMutationInput,
  options: M0WikiMutationOptions,
) => ({
  body: {
    mutation_id: options.mutationId?.trim() || createMutationId(),
    entity_type: input.entityType,
    business_key: input.businessKey.trim(),
    version_id: input.versionId?.trim() || '',
    payload: input.payload,
    relations: input.relations ?? [],
    expected_version_row_id: input.expectedVersionRowId?.trim() || '',
    reason: input.reason?.trim() || '',
  },
  headers: {
    'X-Yunpai-Task-ID': options.trackingTaskId?.trim() || createM0TrackingTaskId(),
  },
});

export async function searchM0Wiki(query: string, limit = 10): Promise<M0SearchResultItem[]> {
  const response = await requestJson<unknown>(`/m0/search`, {
    method: 'POST',
    body: { query, limit },
  });
  const payload = unwrapEnvelope<{ results?: M0SearchResultItem[] }>(response);
  return payload.results ?? [];
}

export function getM0WikiProduct(productCode: string, asOf = ''): Promise<M0WikiProduct> {
  return requestJson<unknown>(
    withQuery(`/m0/wiki/products/${encodeURIComponent(productCode)}`, { as_of: asOf || undefined }),
  ).then((response) => unwrapEnvelope<M0WikiProduct>(response));
}

export function getM0WikiBomLines(
  productCode: string,
  bom: string,
  revision: string,
): Promise<M0WikiBomLines> {
  return requestJson<unknown>(
    withQuery(`/m0/wiki/products/${encodeURIComponent(productCode)}/bom`, { bom, revision }),
  ).then((response) => unwrapEnvelope<M0WikiBomLines>(response));
}

export function getM0WikiBomDiff(
  productCode: string,
  bom: string,
  base: string,
  target: string,
): Promise<M0WikiBomDiff> {
  return requestJson<unknown>(
    withQuery(`/m0/wiki/products/${encodeURIComponent(productCode)}/bom/diff`, { bom, base, target }),
  ).then((response) => unwrapEnvelope<M0WikiBomDiff>(response));
}

export function getM0WikiMaterial(materialCode: string): Promise<M0WikiMaterial> {
  return requestJson<unknown>(`/m0/wiki/materials/${encodeURIComponent(materialCode)}`)
    .then((response) => unwrapEnvelope<M0WikiMaterial>(response));
}

export function getM0WikiEquipment(equipmentCode: string): Promise<M0WikiEquipment> {
  return requestJson<unknown>(`/m0/wiki/equipment/${encodeURIComponent(equipmentCode)}`)
    .then((response) => unwrapEnvelope<M0WikiEquipment>(response));
}

export function getM0WikiEntity(
  entityType: M0WikiEntityType,
  businessKey: string,
  versionId?: string,
): Promise<M0WikiEntityDetail> {
  return requestJson<unknown>(
    withQuery(
      `/m0/wiki/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(businessKey)}`,
      { version: versionId || undefined },
    ),
  ).then((response) => unwrapEnvelope<M0WikiEntityDetail>(response));
}

export function createM0WikiEntity(
  input: M0WikiEntityMutationInput,
  options: M0WikiMutationOptions = {},
): Promise<M0WikiMutationResult> {
  const request = mutationRequest(input, options);
  return requestJson<unknown>('/m0/wiki/entities', {
    method: 'POST',
    ...request,
  }).then((response) => unwrapEnvelope<M0WikiMutationResult>(response));
}

export function updateM0WikiEntity(
  input: M0WikiEntityMutationInput,
  options: M0WikiMutationOptions = {},
): Promise<M0WikiMutationResult> {
  const request = mutationRequest(input, options);
  return requestJson<unknown>(
    `/m0/wiki/entities/${encodeURIComponent(input.entityType)}/${encodeURIComponent(input.businessKey)}`,
    { method: 'PATCH', ...request },
  ).then((response) => unwrapEnvelope<M0WikiMutationResult>(response));
}

export function deleteM0WikiEntity(
  input: Pick<M0WikiEntityMutationInput, 'entityType' | 'businessKey' | 'versionId' | 'expectedVersionRowId' | 'reason'>,
  options: M0WikiMutationOptions = {},
): Promise<M0WikiMutationResult> {
  return requestJson<unknown>(
    `/m0/wiki/entities/${encodeURIComponent(input.entityType)}/${encodeURIComponent(input.businessKey)}`,
    {
      method: 'DELETE',
      headers: {
        'X-Yunpai-Task-ID': options.trackingTaskId?.trim() || createM0TrackingTaskId(),
      },
      body: {
        mutation_id: options.mutationId?.trim() || createMutationId(),
        version_id: input.versionId?.trim() || '',
        expected_version_row_id: input.expectedVersionRowId?.trim() || '',
        reason: input.reason?.trim() || '',
      },
    },
  ).then((response) => unwrapEnvelope<M0WikiMutationResult>(response));
}
