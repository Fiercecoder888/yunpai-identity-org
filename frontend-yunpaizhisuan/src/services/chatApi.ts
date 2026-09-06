import { toApiUrl } from './apiGateway';
import { z } from 'zod';
import { authRuntime } from '../auth/authRuntime';
import { requestJson, requestText } from './httpClient';
import { uuidV4 } from '../utils/uuid';

export type ChatChunk = {
  id: string;
  content: string;
  done: boolean;
};

export type ChatStreamRequest = {
  message: string;
  session_id?: string;
  conversation_id?: string;
  client_message_id?: string;
  use_memory?: boolean;
  tools?: string[];
  context?: Record<string, unknown>;
  options?: {
    stream_tokens?: boolean;
    stream_tool_events?: boolean;
    max_steps?: number;
  };
  document?: Record<string, unknown>;
  documents?: Array<Record<string, unknown>>;
  attachments?: Array<Record<string, unknown>>;
};
export type LocalGate = { type: string; title?: string; reason?: string; message?: string; step_index?: number; tool?: string; module?: string; [key: string]: unknown };

export type ChatToolDataRef = {
  /** 数据类型：bom=物料明细行 / sop=SOP 参数行 / drawing=工程图文件 */
  kind: 'bom' | 'sop' | 'drawing';
  title: string;
  summary?: string;
  /** kind=bom|sop 时携带的表格行 */
  rows?: Array<Record<string, unknown>>;
  /** kind=drawing 时携带的文件预览地址（网关相对路径，如 /api/m1/files/{task_id}） */
  file_url?: string;
};

export type ChatStreamEvent =
  | {
      type: 'message_start';
      message_id: string;
      session_id: string;
      conversation_id: string;
      created_at: string;
      user_message_id?: string;
      assistant_message_id?: string;
      run_id?: string;
      conversation_version?: number;
      conversation_title?: string;
      conversation_title_source?: 'auto' | 'manual';
    }
  | {
      type: 'memory_recall';
      similar_episodes: number;
      recent_session: number;
    }
  | {
      type: 'delta';
      message_id: string;
      content: string;
    }
  | {
      type: 'error';
      message_id: string;
      code: string;
      message: string;
      recoverable: boolean;
    }
  | {
      type: 'tool_start';
      message_id: string;
      step_id: string;
      tool: string;
      label: string;
    }
  | {
      type: 'tool_result';
      message_id: string;
      step_id: string;
      tool: string;
      status: 'ok';
      duration_ms: number;
      summary: string;
      result?: unknown;
      result_truncated?: boolean;
      /** 工具调用产出的结构化数据引用；未产出结构化数据时不携带 */
      data_ref?: ChatToolDataRef;
    }
  | {
      type: 'tool_error';
      message_id: string;
      step_id: string;
      tool: string;
      status: 'failed';
      duration_ms: number;
      error: string;
    }
  | {
      type: 'message_done';
      message_id: string;
      finish_reason: 'stop' | 'error' | 'cancelled';
      content?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    }
  | { type: 'gate_opened'; message_id: string; run_id: string; task_id?: string; gate: LocalGate };

export type ChatStreamItem = ChatChunk | ChatStreamEvent;

export type ChatStreamOptions = {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  trackingTaskId?: string;
};

export class ChatStreamHttpError extends Error {
  status: number;
  payload?: unknown;

  constructor(status: number, message: string, payload?: unknown) {
    super(message);
    this.name = 'ChatStreamHttpError';
    this.status = status;
    this.payload = payload;
  }
}

export class ChatStreamParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatStreamParseError';
  }
}

let chatSessionId: string | undefined;

const createSessionId = () => {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `dashboard-chat-${suffix}`;
};

const getChatSessionId = () => {
  if (chatSessionId) {
    return chatSessionId;
  }

  chatSessionId = createSessionId();

  return chatSessionId;
};

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object';

const nonEmptyString = z.string().min(1);
const chatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message_start'),
    message_id: nonEmptyString,
    session_id: nonEmptyString,
    conversation_id: nonEmptyString,
    created_at: nonEmptyString,
    user_message_id: nonEmptyString.optional(),
    assistant_message_id: nonEmptyString.optional(),
    run_id: nonEmptyString.optional(),
    conversation_version: z.number().int().positive().optional(),
    conversation_title: nonEmptyString.optional(),
    conversation_title_source: z.enum(['auto', 'manual']).optional(),
  }),
  z.object({
    type: z.literal('memory_recall'),
    similar_episodes: z.number().int().nonnegative(),
    recent_session: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('delta'), message_id: nonEmptyString, content: z.string() }),
  z.object({
    type: z.literal('error'),
    message_id: nonEmptyString,
    code: nonEmptyString,
    message: nonEmptyString,
    recoverable: z.boolean(),
  }),
  z.object({
    type: z.literal('tool_start'),
    message_id: nonEmptyString,
    step_id: nonEmptyString,
    tool: nonEmptyString,
    label: nonEmptyString,
  }),
  z.object({
    type: z.literal('tool_result'),
    message_id: nonEmptyString,
    step_id: nonEmptyString,
    tool: nonEmptyString,
    status: z.literal('ok'),
    duration_ms: z.number().nonnegative(),
    summary: z.string(),
    result: z.unknown().optional(),
    result_truncated: z.boolean().optional(),
    data_ref: z
      .object({
        kind: z.enum(['bom', 'sop', 'drawing']),
        title: z.string(),
        summary: z.string().optional(),
        rows: z.array(z.record(z.string(), z.unknown())).optional(),
        file_url: z.string().optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal('tool_error'),
    message_id: nonEmptyString,
    step_id: nonEmptyString,
    tool: nonEmptyString,
    status: z.literal('failed'),
    duration_ms: z.number().nonnegative(),
    error: nonEmptyString,
  }),
  z.object({
    type: z.literal('message_done'),
    message_id: nonEmptyString,
    finish_reason: z.enum(['stop', 'error', 'cancelled']),
    content: z.string().optional(),
    usage: z
      .object({ input_tokens: z.number().int().nonnegative().optional(), output_tokens: z.number().int().nonnegative().optional() })
      .optional(),
  }),
  z.object({ type: z.literal('gate_opened'), message_id: nonEmptyString, run_id: nonEmptyString, task_id: nonEmptyString.optional(), gate: z.record(z.string(), z.unknown()) }),
]);

export function isChatStreamEvent(value: ChatStreamItem): value is ChatStreamEvent {
  return chatStreamEventSchema.safeParse(value).success;
}

export function parseNdjsonChatEvent(line: string): ChatStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new ChatStreamParseError(error instanceof Error ? error.message : 'NDJSON 解析失败');
  }

  if (!isObject(parsed) || typeof parsed.type !== 'string') {
    throw new ChatStreamParseError('NDJSON 事件格式无效');
  }

  const result = chatStreamEventSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.') || 'event'}: ${issue.message}`).join('; ');
    throw new ChatStreamParseError(`NDJSON 事件 ${parsed.type} 协议无效：${details}`);
  }

  return result.data as ChatStreamEvent;
}

type LocalRunEvent = { type: string; run_id?: string; task_id?: string; at?: string; content?: string; gate?: LocalGate; state?: Record<string, unknown>; step?: Record<string, unknown>; output_summary?: unknown; code?: string; message?: string };
const localMessageId = (runId: string) => `local-assistant-${runId}`;
async function* streamLocalRun(path: string, body: Record<string, unknown>, options: ChatStreamOptions = {}): AsyncGenerator<ChatStreamEvent> {
  const response = await (options.fetchImpl ?? fetch)(toApiUrl(path), { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/x-ndjson', 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: options.signal });
  if (!response.ok) { const text = await response.text().catch(() => ''); throw new ChatStreamHttpError(response.status, text || `本地编排请求失败：HTTP ${response.status}`); }
  if (!response.body) throw new ChatStreamParseError('浏览器不支持流式响应');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let runId = ''; let messageId = '';
  const requestedConversationId = typeof (body.request as Record<string, unknown> | undefined)?.conversation_id === 'string' ? String((body.request as Record<string, unknown>).conversation_id) : undefined;
  const map = (raw: LocalRunEvent): ChatStreamEvent | null => {
    runId = raw.run_id || runId; messageId ||= localMessageId(runId || 'pending');
    if (raw.type === 'run_start') return { type: 'message_start', message_id: messageId, session_id: raw.task_id || runId, conversation_id: requestedConversationId || runId, created_at: raw.at || new Date().toISOString(), run_id: runId };
    if (raw.type === 'assistant_delta') return { type: 'delta', message_id: messageId, content: raw.content || '' };
    if (raw.type === 'step_start') { const step = raw.step || {}; return { type: 'tool_start', message_id: messageId, step_id: String(step.id || step.tool || `step-${Date.now()}`), tool: String(step.tool || 'unknown'), label: String(step.label || step.module || step.tool || '执行步骤') }; }
    if (raw.type === 'step_result') { const step = raw.step || {}; const summary = raw.output_summary ?? step.output_summary ?? {}; return { type: 'tool_result', message_id: messageId, step_id: String(step.id || step.tool || ''), tool: String(step.tool || 'unknown'), status: 'ok', duration_ms: 0, summary: typeof summary === 'string' ? summary : JSON.stringify(summary), result: summary }; }
    if (raw.type === 'gate_opened' && raw.gate) return { type: 'gate_opened', message_id: messageId, run_id: runId, task_id: raw.task_id, gate: raw.gate };
    if (raw.type === 'run_error') return { type: 'error', message_id: messageId, code: raw.code || 'RUN_ERROR', message: raw.message || '本地运行失败', recoverable: true };
    if (raw.type === 'run_done') { const state = raw.state || {}; return { type: 'message_done', message_id: messageId, finish_reason: state.status === 'failed' ? 'error' : 'stop' }; }
    return null;
  };
  try { while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ''; for (const line of lines) { if (!line.trim()) continue; const event = map(JSON.parse(line) as LocalRunEvent); if (event) yield event; } } buffer += decoder.decode(); if (buffer.trim()) { const event = map(JSON.parse(buffer) as LocalRunEvent); if (event) yield event; } } finally { reader.releaseLock(); }
}
export const resumeLocalRunStream = (runId: string, decision: string, supplement?: Record<string, unknown>, options: ChatStreamOptions = {}) => streamLocalRun(`/runs/${encodeURIComponent(runId)}/resume/stream`, { decision, ...(supplement ? { supplement } : {}) }, options);

export async function* streamChatFromOrchestrator(
  input: string | ChatStreamRequest,
  options: ChatStreamOptions = {},
): AsyncGenerator<ChatStreamEvent> {
  const request: ChatStreamRequest =
    typeof input === 'string'
      ? {
          message: input,
          session_id: getChatSessionId(),
          client_message_id: globalThis.crypto?.randomUUID?.() ?? uuidV4(),
          use_memory: true,
          tools: [],
          context: { page: 'assistant' },
          options: { stream_tokens: true, stream_tool_events: true, max_steps: 10 },
        }
      : {
          ...input,
          session_id: input.session_id ?? getChatSessionId(),
          conversation_id: input.conversation_id,
          client_message_id: input.client_message_id ?? globalThis.crypto?.randomUUID?.() ?? uuidV4(),
          use_memory: input.use_memory ?? true,
          tools: input.tools ?? [],
          context: { page: 'assistant', ...(input.context ?? {}) },
        options: { stream_tokens: true, stream_tool_events: true, max_steps: 10, ...(input.options ?? {}) },
      };

  if (import.meta.env.VITE_LOCAL_LANGGRAPH === 'true') { yield* streamLocalRun('/runs/stream', { request }, options); return; }

  const doFetch = options.fetchImpl ?? fetch;
  const fetchStream = () => doFetch(toApiUrl('/orchestrator/chat/stream'), {
      method: 'POST', credentials: 'same-origin',
      headers: {
        Accept: 'application/x-ndjson', 'Content-Type': 'application/json',
        ...(authRuntime.getCsrfToken() ? { 'X-CSRF-Token': authRuntime.getCsrfToken() as string } : {}),
        ...(options.trackingTaskId ? { 'X-Yunpai-Task-ID': options.trackingTaskId } : {}),
      },
      body: JSON.stringify(request), signal: options.signal,
    });
  let response = await fetchStream();
  if (response.status === 401 && (await authRuntime.recover())) response = await fetchStream();

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : undefined;
    } catch {
      payload = undefined;
    }
    throw new ChatStreamHttpError(response.status, text || `企业助手请求失败：HTTP ${response.status}`, payload);
  }
  if (!response.body) {
    throw new ChatStreamParseError('浏览器不支持流式响应');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const event = parseNdjsonChatEvent(line);
        if (event) {
          yield event;
        }
      }
    }

    buffer += decoder.decode();
    const finalEvent = parseNdjsonChatEvent(buffer);
    if (finalEvent) {
      yield finalEvent;
    }
  } finally {
    reader.releaseLock();
  }
}

export const simulateChatStream = streamChatFromOrchestrator;

export type ChatConversation = {
  id: string;
  title: string;
  title_source: 'auto' | 'manual';
  status: 'active';
  last_message_at?: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type ChatHistoryMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'completed' | 'streaming' | 'partial';
  created_at: string;
  structured_data?: Record<string, unknown> | null;
  attachments?: Array<{
    id: string;
    name: string;
    size?: number;
    kind?: 'order' | 'm0' | 'm1';
    taskId?: string;
    runId?: string;
  }>;
  run?: { status: string; finish_reason?: string; error?: string; tool_steps: Array<{ step_id: string; tool: string; status: string; safe_summary?: string; duration_ms?: number; safe_result?: string | null; result_truncated?: boolean }> } | null;
};

export type ChatPage<T> = { items: T[]; next_cursor?: string | null };
const LOCAL_CONVERSATIONS_KEY = 'yunpai.local-agent-conversations';
const readLocalConversations = (): ChatConversation[] => { try { const value = JSON.parse(globalThis.localStorage?.getItem(LOCAL_CONVERSATIONS_KEY) || '[]'); return Array.isArray(value) ? value as ChatConversation[] : []; } catch { return []; } };
const writeLocalConversations = (items: ChatConversation[]) => globalThis.localStorage?.setItem(LOCAL_CONVERSATIONS_KEY, JSON.stringify(items));
const localConversation = (title = '新对话'): ChatConversation => { const now = new Date().toISOString(); return { id: `local-${uuidV4()}`, title, title_source: 'auto', status: 'active', created_at: now, updated_at: now, last_message_at: now, version: 1 }; };

/** Keep local conversation labels useful when the local graph has no title-generation endpoint. */
export const buildConversationSummary = (prompt: string): string => {
  const normalized = prompt.replace(/\s+/g, ' ').trim();
  const file = normalized.match(/([^\s/\\]+\.(?:xlsx|xls|csv|pdf|json))/i)?.[1];
  const topic = /采购|供应商|缺料/.test(normalized)
    ? '采购与物料'
    : /排程|生产计划|交期/.test(normalized)
      ? '生产排程'
      : /bom|sop/i.test(normalized)
        ? 'BOM/SOP'
        : /库存|入库|领料/.test(normalized)
          ? '库存与仓库'
          : /订单|客户订单/.test(normalized)
            ? '订单处理'
            : undefined;
  let summary = file
    ? `${topic ?? '订单处理'} · ${file}`
    : topic
      ? `${topic} · ${normalized.replace(/^请(帮我|你|根据.*?)(查询|查看|处理|执行)?/, '').trim()}`
      : normalized;
  summary = summary.replace(/[。！？!?]+$/u, '').trim();
  const chars = Array.from(summary);
  return chars.length > 32 ? `${chars.slice(0, 31).join('')}…` : summary || '新对话';
};

export const saveLocalConversationSummary = (id: string, title: string): ChatConversation | undefined => {
  const current = readLocalConversations();
  const updated = current.map((item) => item.id === id && item.title_source !== 'manual'
    ? { ...item, title, title_source: 'auto' as const, updated_at: new Date().toISOString(), last_message_at: new Date().toISOString() }
    : item);
  if (updated.some((item, index) => item !== current[index])) writeLocalConversations(updated);
  return updated.find((item) => item.id === id);
};

export const listChatConversations = async (q?: string, cursor?: string, limit = 30): Promise<ChatPage<ChatConversation>> => {
  const params: string[] = [];
  if (q) params.push(`q=${encodeURIComponent(q)}`);
  if (cursor) params.push(`cursor=${encodeURIComponent(cursor)}`);
  if (limit !== 30) params.push(`limit=${limit}`);
  const query = params.length ? `?${params.join('&')}` : '';
  if (import.meta.env.VITE_LOCAL_LANGGRAPH === 'true') {
    const items = readLocalConversations().filter((item) => !q || item.title.includes(q));
    return { items: cursor ? [] : items.slice(0, limit), next_cursor: null };
  }
  try { return await requestJson<ChatPage<ChatConversation>>(`/orchestrator/chat/conversations${query}`); } catch { const items = readLocalConversations().filter((item) => !q || item.title.includes(q)); return { items: cursor ? [] : items.slice(0, limit), next_cursor: null }; }
};
export const createChatConversation = async (title = '新对话'): Promise<ChatConversation> => {
  if (import.meta.env.VITE_LOCAL_LANGGRAPH === 'true') {
    const conversation = localConversation(title);
    writeLocalConversations([conversation, ...readLocalConversations()]);
    return conversation;
  }
  try { return await requestJson<ChatConversation>('/orchestrator/chat/conversations', { method: 'POST', body: { title } }); } catch { const conversation = localConversation(title); writeLocalConversations([conversation, ...readLocalConversations()]); return conversation; }
};
export const getChatMessages = async (id: string, cursor?: string, limit = 50): Promise<ChatPage<ChatHistoryMessage>> => {
  const params: string[] = [];
  if (cursor) params.push(`cursor=${encodeURIComponent(cursor)}`);
  if (limit !== 50) params.push(`limit=${limit}`);
  const query = params.length ? `?${params.join('&')}` : '';
  if (import.meta.env.VITE_LOCAL_LANGGRAPH === 'true') return { items: [], next_cursor: null };
  try { return await requestJson<ChatPage<ChatHistoryMessage>>(`/orchestrator/chat/conversations/${id}/messages${query}`); } catch { return { items: [], next_cursor: null }; }
};
export const renameChatConversation = async (id: string, title: string, version: number) => {
  if (import.meta.env.VITE_LOCAL_LANGGRAPH === 'true') {
    const current = readLocalConversations();
    const updated = current.map((item) => item.id === id ? { ...item, title, title_source: 'manual' as const, version: Math.max(item.version, version) + 1, updated_at: new Date().toISOString() } : item);
    writeLocalConversations(updated);
    return updated.find((item) => item.id === id) ?? localConversation(title);
  }
  return requestJson<ChatConversation>(`/orchestrator/chat/conversations/${id}`, { method: 'PATCH', body: { title, version } });
};
export const deleteChatConversation = async (id: string, version: number) => {
  if (import.meta.env.VITE_LOCAL_LANGGRAPH === 'true') {
    writeLocalConversations(readLocalConversations().filter((item) => item.id !== id));
    return '';
  }
  return requestText(`/orchestrator/chat/conversations/${id}`, { method: 'DELETE', headers: { 'If-Match': String(version) } });
};

export type LocalAssistantMessageResponse = {
  message: ChatHistoryMessage;
  conversation: ChatConversation;
};

export const createLocalAssistantMessage = (
  conversationId: string,
  content: string,
  structuredData: { kind: 'm7_delivery_draft'; draft: Record<string, unknown> | null },
  clientMessageId = uuidV4(),
) => requestJson<LocalAssistantMessageResponse>(
  `/orchestrator/chat/conversations/${conversationId}/local-assistant-messages`,
  {
    method: 'POST',
    body: {
      content,
      client_message_id: clientMessageId,
      source: 'm7_delivery_workflow',
      structured_data: structuredData,
    },
  },
);

export type FollowUpsRequest = {
  message: string;
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
};

export type FollowUpsResponse = {
  questions: string[];
  source: 'llm' | 'fallback' | 'failed';
  error?: string;
};

export const requestFollowUps = (input: FollowUpsRequest) =>
  import.meta.env.VITE_LOCAL_LANGGRAPH === 'true'
    ? Promise.resolve<FollowUpsResponse>({ questions: [], source: 'fallback' })
    : requestJson<FollowUpsResponse>('/orchestrator/chat/follow-ups', { method: 'POST', body: input });
