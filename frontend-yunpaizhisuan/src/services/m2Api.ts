import {
  m2BomHistoryResultSchema,
  m2ControlledBomSchema,
  m2HealthSchema,
  m2SopResultSchema,
  m2TemplateOnboardResultSchema,
  m2WorkflowResultSchema,
} from '../schemas/m2';
import { withQuery } from './apiGateway';
import { requestBlob, requestJson } from './httpClient';

const unwrapM2Result = (payload: unknown) => {
  const parsed = m2WorkflowResultSchema.parse(payload);
  return 'result' in parsed && parsed.result !== undefined ? parsed.result : parsed;
};

export function getM2Health() {
  return requestJson<unknown>('/m2/health').then((response) => m2HealthSchema.parse(response));
}

export function runM2Workflow(payload: unknown) {
  return requestJson<unknown>('/m2/run', { method: 'POST', body: payload }).then(unwrapM2Result);
}

export function downloadM2Artifact(path: string) {
  return requestBlob(withQuery('/m2/artifact', { path }));
}

export function readM2ArtifactJson(path: string) {
  return requestJson<unknown>(withQuery('/m2/artifact', { path }));
}

export function searchM2BomHistory(payload: unknown) {
  return requestJson<unknown>('/m2/bom/history/search', { method: 'POST', body: payload }).then((response) =>
    m2BomHistoryResultSchema.parse(response),
  );
}

export function generateM2ControlledBom(payload: unknown) {
  return requestJson<unknown>('/m2/bom/generate-controlled', { method: 'POST', body: payload }).then((response) =>
    m2ControlledBomSchema.parse(response),
  );
}

export function onboardM2BomTemplate(payload: unknown) {
  return requestJson<unknown>('/m2/bom/templates/onboard', { method: 'POST', body: payload }).then((response) =>
    m2TemplateOnboardResultSchema.parse(response),
  );
}

export function generateM2Sop(payload: unknown) {
  return requestJson<unknown>('/m2/sop/generate', { method: 'POST', body: payload }).then((response) => m2SopResultSchema.parse(response));
}
