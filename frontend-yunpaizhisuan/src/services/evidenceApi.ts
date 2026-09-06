import { unwrapEnvelope } from './apiResponse';
import { withQuery } from './apiGateway';
import { requestJson } from './httpClient';

export const evidenceModules = ['m3', 'm4', 'm5'] as const;
export type EvidenceModule = (typeof evidenceModules)[number];
export type EvidenceDecision = 'accept' | 'reject';

export type EvidenceRow = {
  rowId: string;
  domainRef?: string;
  confidence?: number;
  state: string;
  rawValue?: unknown;
  agentCandidate?: unknown;
  corrections: unknown[];
  pendingItems?: unknown;
  sourceRefs: unknown[];
  resolvedBy?: string;
  resolveNote?: string;
  appliedRef?: string;
  factId?: string;
  allowedActions: EvidenceDecision[];
  acceptBlockedReason?: string;
};

export type EvidenceBatch = {
  batchId: string;
  module: EvidenceModule;
  sourceKind?: string;
  sourceRef?: string;
  sourceFactId?: string;
  trackingTaskId?: string;
  state: string;
  appliedRef?: string;
  factId?: string;
  committedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  allowedActions?: string[];
  rows: EvidenceRow[];
};

export type EvidenceAuditEntry = {
  id: string;
  batchId: string;
  rowId?: string;
  fromState: string;
  toState: string;
  actor?: string;
  reason?: string;
  createdAt?: string;
};

export type EvidenceCommitResult = {
  batchId: string;
  state: string;
  appliedRef?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const asString = (value: unknown) => typeof value === 'string' && value.trim() ? value : undefined;
const asNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const asArray = (value: unknown) => Array.isArray(value) ? value : [];
const asDecisions = (value: unknown): EvidenceDecision[] => asArray(value).filter(
  (item): item is EvidenceDecision => item === 'accept' || item === 'reject',
);

const moduleBase = (module: EvidenceModule) => `/${module}/evidence`;

const parseRow = (value: unknown): EvidenceRow => {
  if (!isRecord(value)) {
    throw new Error('证据行响应缺少 row_id 或 row_state');
  }
  const rowId = asString(value.row_id);
  const state = asString(value.row_state);
  if (!rowId || !state) throw new Error('证据行响应缺少 row_id 或 row_state');
  return {
    rowId,
    domainRef: asString(value.domain_ref),
    confidence: asNumber(value.confidence),
    state,
    rawValue: value.raw_value,
    agentCandidate: value.agent_candidate,
    corrections: asArray(value.corrections),
    pendingItems: value.pending_items,
    sourceRefs: asArray(value.source_refs),
    resolvedBy: asString(value.resolved_by),
    resolveNote: asString(value.resolve_note),
    appliedRef: asString(value.applied_ref),
    factId: asString(value.fact_id),
    allowedActions: asDecisions(value.allowed_actions),
    acceptBlockedReason: asString(value.accept_blocked_reason),
  };
};

const parseBatch = (module: EvidenceModule, value: unknown): EvidenceBatch => {
  if (!isRecord(value)) {
    throw new Error('证据批次响应缺少 batch_id 或 state');
  }
  const batchId = asString(value.batch_id);
  const state = asString(value.state);
  if (!batchId || !state) throw new Error('证据批次响应缺少 batch_id 或 state');
  return {
    batchId,
    module,
    sourceKind: asString(value.source_kind),
    sourceRef: asString(value.source_ref),
    sourceFactId: asString(value.source_fact_id),
    trackingTaskId: asString(value.tracking_task_id),
    state,
    appliedRef: asString(value.applied_ref),
    // Source facts remain provenance.  A Fact ID is only an applied local fact.
    factId: asString(value.fact_id),
    committedAt: asString(value.committed_at),
    createdAt: asString(value.created_at),
    updatedAt: asString(value.updated_at),
    allowedActions: asArray(value.allowed_actions).filter((item): item is string => typeof item === 'string'),
    rows: asArray(value.rows).map(parseRow),
  };
};

const parseAudit = (value: unknown): EvidenceAuditEntry => {
  if (!isRecord(value)) {
    throw new Error('证据审计响应缺少必填状态字段');
  }
  const id = asString(value.id);
  const batchId = asString(value.batch_id);
  const fromState = asString(value.from_state);
  const toState = asString(value.to_state);
  if (!id || !batchId || !fromState || !toState) throw new Error('证据审计响应缺少必填状态字段');
  return {
    id,
    batchId,
    rowId: asString(value.row_id),
    fromState,
    toState,
    actor: asString(value.actor),
    reason: asString(value.reason),
    createdAt: asString(value.created_at),
  };
};

const unwrapData = <T>(payload: unknown): T => {
  const unwrapped = unwrapEnvelope<unknown>(payload);
  if (isRecord(unwrapped) && 'data' in unwrapped) return unwrapped.data as T;
  return unwrapped as T;
};

export async function listEvidenceReviewQueue(module: EvidenceModule): Promise<EvidenceBatch[]> {
  const path = module === 'm4'
    ? withQuery(`${moduleBase(module)}/batches`, { state: 'actionable', limit: 50 })
    : withQuery(`${moduleBase(module)}/review-queue`, { limit: 50 });
  const payload = unwrapData<unknown>(await requestJson<unknown>(path));
  if (!Array.isArray(payload)) throw new Error('证据待裁决列表响应不是数组');
  return payload.map((item) => parseBatch(module, item));
}

export async function getEvidenceBatch(module: EvidenceModule, batchId: string): Promise<EvidenceBatch> {
  const payload = unwrapData<unknown>(await requestJson<unknown>(`${moduleBase(module)}/batch/${encodeURIComponent(batchId)}`));
  return parseBatch(module, payload);
}

export async function listEvidenceAudit(module: EvidenceModule, batchId: string): Promise<EvidenceAuditEntry[]> {
  const path = withQuery(`${moduleBase(module)}/history`, { batch_id: batchId, limit: 100 });
  const payload = unwrapData<unknown>(await requestJson<unknown>(path));
  if (!Array.isArray(payload)) throw new Error('证据审计响应不是数组');
  return payload.map(parseAudit);
}

export async function resolveEvidenceRow(
  module: EvidenceModule,
  batchId: string,
  rowId: string,
  decision: EvidenceDecision,
  note: string,
): Promise<EvidenceRow> {
  const payload = unwrapData<unknown>(await requestJson<unknown>(
    `${moduleBase(module)}/batch/${encodeURIComponent(batchId)}/resolve/${encodeURIComponent(rowId)}`,
    { method: 'POST', body: { decision, note } },
  ));
  return parseRow(payload);
}

export async function commitEvidenceBatch(module: EvidenceModule, batchId: string): Promise<EvidenceCommitResult> {
  const payload = unwrapData<unknown>(await requestJson<unknown>(
    `${moduleBase(module)}/batch/${encodeURIComponent(batchId)}/commit`,
    { method: 'POST' },
  ));
  if (!isRecord(payload)) throw new Error('证据提交响应不是对象');
  const returnedBatchId = asString(payload.batch_id);
  const state = asString(payload.state);
  if (!returnedBatchId || !state) throw new Error('证据提交响应缺少 batch_id 或 state');
  return { batchId: returnedBatchId, state, appliedRef: asString(payload.applied_ref) };
}
