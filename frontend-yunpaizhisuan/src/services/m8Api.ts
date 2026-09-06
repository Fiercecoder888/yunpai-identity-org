import { m8CadContractSchema, m8CadRequestSchema, m8HealthSchema, m8ProjectSchema, m8RunSchema } from '../schemas/m8';
import { requestBlob, requestJson, requestText } from './httpClient';

export function getM8Health() {
  return requestJson<unknown>('/m8/health').then((response) => m8HealthSchema.parse(response));
}

export function createM8Project(payload: unknown) {
  return requestJson<unknown>('/m8/projects', { method: 'POST', body: payload }).then((response) => m8ProjectSchema.parse(response));
}

export function getM8Project(projectId: string) {
  return requestJson<unknown>(`/m8/projects/${projectId}`).then((response) => m8ProjectSchema.parse(response));
}

export function sendM8ProjectMessage(projectId: string, payload: unknown) {
  return requestJson<unknown>(`/m8/projects/${projectId}/messages`, { method: 'POST', body: payload }).then((response) =>
    m8RunSchema.parse(response),
  );
}

export function getM8Run(projectId: string, runId: string) {
  return requestJson<unknown>(`/m8/projects/${projectId}/runs/${runId}`).then((response) => m8RunSchema.parse(response));
}

export function submitM8HumanDecision(projectId: string, payload: unknown) {
  return requestJson<unknown>(`/m8/projects/${projectId}/human-decisions`, { method: 'POST', body: payload });
}

export function getM8OutputJson<T = unknown>(projectId: string, key: string) {
  return requestJson<T>(`/m8/projects/${projectId}/outputs/${key}`);
}

export function getM8OutputText(projectId: string, key: string) {
  return requestText(`/m8/projects/${projectId}/outputs/${key}`);
}

export function getM8Asset(projectId: string, key: string) {
  return requestBlob(`/m8/projects/${projectId}/assets/${key}`);
}

export function getM8CadDrawingAgentContract() {
  return requestJson<unknown>('/m8/cad-drawing-agent/contract').then((response) => m8CadContractSchema.parse(response));
}

export function createM8CadDrawingRequest(projectId: string, payload: unknown) {
  return requestJson<unknown>(`/m8/projects/${projectId}/cad-drawing-requests`, { method: 'POST', body: payload }).then((response) =>
    m8CadRequestSchema.parse(response),
  );
}
