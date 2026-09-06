import {
  orchestratorHealthSchema,
  orchestratorInvokeResponseSchema,
  orchestratorJobListSchema,
  orchestratorJobSchema,
  orchestratorMemoryResultSchema,
  type OrchestratorJob,
} from '../schemas/orchestrator';
import { withQuery } from './apiGateway';
import { requestJson } from './httpClient';

export type InvokeAgentPayload = {
  task: string;
  session_id?: string;
  context?: Record<string, unknown>;
  tools?: string[];
  tool_payloads?: Record<string, unknown>;
  use_memory?: boolean;
  stop_on_failure?: boolean;
};

export function getOrchestratorHealth() {
  return requestJson<unknown>('/orchestrator/health').then((payload) => orchestratorHealthSchema.parse(payload));
}

export function invokeAgent(payload: InvokeAgentPayload) {
  return requestJson<unknown>('/orchestrator/invoke', {
    method: 'POST',
    body: payload,
  }).then((response) => orchestratorInvokeResponseSchema.parse(response));
}

export function getJob(jobId: string): Promise<OrchestratorJob> {
  return requestJson<unknown>(`/orchestrator/jobs/${jobId}`).then((response) => orchestratorJobSchema.parse(response));
}

export async function listJobs(params: { session_id?: string; limit?: number } = {}) {
  const response = await requestJson<unknown>(withQuery('/orchestrator/jobs', params));
  const parsed = orchestratorJobListSchema.parse(response);
  return Array.isArray(parsed) ? parsed : parsed.items;
}

export function searchSimilarMemory(params: { task: string; top_k?: number }) {
  return requestJson<unknown>(withQuery('/orchestrator/memory/similar', params)).then((response) =>
    orchestratorMemoryResultSchema.parse(response),
  );
}
