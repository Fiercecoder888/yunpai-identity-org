import type { Attachment, RunState, StreamEvent } from './types';

const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

function tenantId() {
  if (typeof window === 'undefined') return 'default';
  return new URLSearchParams(window.location.search).get('tenant_id') || 'default';
}

export type RunRequest = {
  message: string;
  workflow?: string;
  attachments?: Attachment[];
  [key: string]: unknown;
};

function apiUrl(path: string) {
  return `${apiBase.replace(/\/$/, '')}${path}`;
}

export function parseNdjsonLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const value: unknown = JSON.parse(trimmed);
  if (!value || typeof value !== 'object' || !('type' in value) || typeof value.type !== 'string') {
    throw new Error('流式事件格式无效');
  }
  return value as StreamEvent;
}

async function* readEvents(response: Response): AsyncGenerator<StreamEvent> {
  if (!response.ok) throw new Error(`Agent 请求失败：HTTP ${response.status}`);
  if (!response.body) throw new Error('浏览器不支持流式响应');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const event = parseNdjsonLine(line);
      if (event) yield event;
    }
  }
  buffer += decoder.decode();
  const event = parseNdjsonLine(buffer);
  if (event) yield event;
}

export async function* streamRun(request: RunRequest, signal?: AbortSignal) {
  const response = await fetch(apiUrl('/runs/stream'), {
    method: 'POST',
    headers: { Accept: 'application/x-ndjson', 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId(), request }),
    signal,
  });
  yield* readEvents(response);
}

export async function* streamResume(runId: string, decision: string, supplement?: Record<string, unknown>, signal?: AbortSignal) {
  const response = await fetch(apiUrl(`/runs/${encodeURIComponent(runId)}/resume/stream`), {
    method: 'POST',
    headers: { Accept: 'application/x-ndjson', 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, supplement, actor: 'operator' }),
    signal,
  });
  yield* readEvents(response);
}

export async function getRuns(): Promise<RunState[]> {
  const response = await fetch(apiUrl(`/runs?tenant_id=${encodeURIComponent(tenantId())}&limit=100`));
  if (!response.ok) throw new Error(`运行列表加载失败：HTTP ${response.status}`);
  return ((await response.json()) as { runs: RunState[] }).runs;
}

export async function getRun(runId: string): Promise<RunState> {
  const response = await fetch(apiUrl(`/runs/${encodeURIComponent(runId)}`));
  if (!response.ok) throw new Error(`运行详情加载失败：HTTP ${response.status}`);
  return (await response.json()) as RunState;
}
