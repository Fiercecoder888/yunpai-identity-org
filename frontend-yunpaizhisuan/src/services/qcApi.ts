import { withQuery } from './apiGateway';
import { unwrapEnvelope } from './apiResponse';
import { requestJson } from './httpClient';

export type QcSourceStatus = {
  source: string;
  label: string;
  count: number;
  status: string;
};

export type QcDashboard = {
  telemetry_total: number;
  quality_total: number;
  sources: QcSourceStatus[];
  quality_by_stage: Record<string, number>;
  recent_events: Array<Record<string, unknown>>;
};

export type QcTelemetryPage = {
  total: number;
  items: Array<Record<string, unknown>>;
};

export async function getQcDashboard(): Promise<QcDashboard> {
  const response = await requestJson<unknown>('/qc/dashboard');
  return unwrapEnvelope<unknown>(response) as QcDashboard;
}

export async function queryQcTelemetry(params: {
  limit?: number;
  machine_code?: string;
  order_id?: string;
  program_id?: string;
}): Promise<QcTelemetryPage> {
  const response = await requestJson<unknown>(
    withQuery('/qc/telemetry', { limit: params.limit ?? 20, ...params }),
  );
  return unwrapEnvelope<unknown>(response) as QcTelemetryPage;
}
