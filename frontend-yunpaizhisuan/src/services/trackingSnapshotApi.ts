import { requestJson } from './httpClient';

export type TrackingEntity = {
  entity_id?: string;
  entity_type?: string;
  module?: string;
  business_id?: string;
  version_id?: string;
  status?: string;
  metadata?: Record<string, unknown>;
  events?: Array<{ type?: string; status?: string; created_at?: string }>;
};

export type TrackingModuleRun = {
  module: string;
  status?: string;
  started_at?: string;
  finished_at?: string;
  error?: string;
};

export type TrackingSnapshot = {
  task_id?: string;
  status?: string;
  module_runs?: TrackingModuleRun[];
  entities?: TrackingEntity[];
  events?: Array<{ type?: string; module?: string; status?: string; created_at?: string }>;
};

export async function getTrackingSnapshot(
  taskId: string,
  options: { includeEventPayload?: boolean; signal?: AbortSignal } = {},
): Promise<TrackingSnapshot> {
  const query = options.includeEventPayload ? '?include_event_payload=true' : '';
  const payload = await requestJson<unknown>(`/orchestrator/tracking/tasks/${encodeURIComponent(taskId)}/snapshot${query}`, {
    signal: options.signal,
  });
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: TrackingSnapshot }).data;
  }
  return payload as TrackingSnapshot;
}

export function getModuleRunStatus(snapshot: TrackingSnapshot | undefined, module: string): string | undefined {
  return snapshot?.module_runs?.find((run) => run.module === module)?.status;
}

export function countEntitiesForModule(snapshot: TrackingSnapshot | undefined, module: string): TrackingEntity[] {
  const entities = snapshot?.entities ?? [];
  return entities.filter((entity) => entity.module === module || (entity.events ?? []).some((event) => event.type === module));
}

export function countEntityType(snapshot: TrackingSnapshot | undefined, entityType: string): number {
  return (snapshot?.entities ?? []).filter((entity) => entity.entity_type === entityType).length;
}
