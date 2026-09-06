import { requestJson } from './httpClient';

export type LocalRunStep = {
  id?: string;
  module?: string;
  tool?: string;
  status?: string;
  input_summary?: unknown;
  output_summary?: unknown;
  started_at?: string;
  finished_at?: string;
};

export type LocalRun = {
  run_id: string;
  task_id?: string;
  tenant_id?: string;
  status: string;
  current_step?: string;
  current_result?: Record<string, unknown>;
  request?: Record<string, unknown>;
  response?: string;
  steps?: LocalRunStep[];
  pending_gate?: Record<string, unknown> | null;
  outputs?: Record<string, unknown>;
  trace?: Array<Record<string, unknown>>;
  model?: Record<string, unknown>;
};

type LocalRunListResponse = { runs?: LocalRun[] } | LocalRun[];

const normalizeRuns = (payload: LocalRunListResponse): LocalRun[] =>
  Array.isArray(payload) ? payload : payload.runs ?? [];

export async function listLocalRuns(limit = 50): Promise<LocalRun[]> {
  const payload = await requestJson<LocalRunListResponse>(`/runs?tenant_id=default&limit=${limit}`);
  return normalizeRuns(payload);
}

export async function getLocalRun(runId: string): Promise<LocalRun> {
  return requestJson<LocalRun>(`/runs/${encodeURIComponent(runId)}`);
}
