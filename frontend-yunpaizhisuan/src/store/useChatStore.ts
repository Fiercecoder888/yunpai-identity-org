import { create } from 'zustand';
import {
  createChatConversation,
  createLocalAssistantMessage,
  ChatStreamHttpError,
  deleteChatConversation,
  getChatMessages,
  isChatStreamEvent,
  listChatConversations,
  renameChatConversation,
  streamChatFromOrchestrator,
  resumeLocalRunStream,
  buildConversationSummary,
  saveLocalConversationSummary,
  type ChatConversation,
  type ChatHistoryMessage,
  type ChatStreamRequest,
  type ChatStreamEvent,
  type ChatStreamItem,
  type ChatStreamOptions,
  type ChatToolDataRef,
} from '../services/chatApi';
import { HttpClientError } from '../services/httpClient';
import { chatStorageKey, onChatStorageScopeChange } from '../services/chatStorageScope';
import { extractToolDataRef } from '../features/chat/toolDataRef';
import { uuidV4 } from '../utils/uuid';

/**
 * 工具步骤状态。后端 orchestrator 的 `step.status` 还有 `blocked`，历史回读时按下述规则归一化，
 * 所以 `ChatToolStep` 不再单列 `blocked`（渲染层不必再判一次）：
 * - `blocked` + `error`（TOOL_FORBIDDEN 权限拒绝，graph.py `record.update(status="blocked", error=…)`）
 *   → `failed` + 原因；
 * - `blocked` 无 `error`（reviewer 未通过、已开人工 Gate，graph.py `record["status"] = "blocked"`）
 *   → `waiting_human`，与 `LocalAgentRunPanel` 的既有语义一致。
 */
export type ChatToolStep = { id: string; tool: string; label: string; status: 'running' | 'waiting_human' | 'ok' | 'failed'; durationMs?: number; summary?: string; error?: string; result?: unknown; resultTruncated?: boolean; dataRef?: ChatToolDataRef };
export type ChatAttachment = {
  id: string;
  name: string;
  size?: number;
  kind?: 'order' | 'm0' | 'm1';
  taskId?: string;
  runId?: string;
};
export type ChatMessage = {
  id: string; role: 'user' | 'assistant'; content: string;
  status?: 'streaming' | 'completed' | 'failed' | 'cancelled'; error?: string;
  runId?: string;
  memoryRecall?: { similarEpisodes: number; recentSession: number }; tools?: ChatToolStep[];
  attachments?: ChatAttachment[];
  structuredData?: Record<string, unknown> | null;
  gate?: {
    runId: string;
    gate: Record<string, unknown>;
    /** Keeps the human-gate audit entry in chat history after a decision. */
    status?: 'pending' | 'approved' | 'retrying' | 'rejected' | 'error' | 'resolved';
  };
};

type ChatStreamFactory = (prompt: string, options?: ChatStreamOptions) => AsyncGenerator<ChatStreamItem>;
type ChatState = {
  draft: string; sending: boolean; streaming: boolean; activeAbortController?: AbortController; messages: ChatMessage[];
  /** The local LangGraph run currently associated with the selected conversation. */
  activeLocalRunId?: string;
  conversations: ChatConversation[]; selectedConversationId?: string; messageSets: Record<string, ChatMessage[]>;
  controllers: Record<string, AbortController>; sidebarCollapsed: boolean; historyLoading: boolean; historyError?: string;
  historyLoadingMore: boolean; conversationNextCursor?: string; conversationQuery?: string;
  messageNextCursors: Record<string, string | undefined>; historyMutationPending: boolean; historyMutationError?: string;
  setDraft: (draft: string) => void; setSidebarCollapsed: (collapsed: boolean) => void;
  resetChat: () => void; newConversation: () => Promise<string>; loadConversations: (q?: string) => Promise<void>;
  loadMoreConversations: () => Promise<void>; selectConversation: (id: string) => Promise<void>; loadMoreMessages: (id?: string) => Promise<void>;
  renameConversation: (conversation: ChatConversation, title: string) => Promise<void>;
  deleteConversation: (conversation: ChatConversation) => Promise<void>;
  startStreaming: (prompt: string, assistantId?: string, userId?: string, conversationId?: string) => string;
  appendStreamingChunk: (assistantId: string, chunk: string, done?: boolean, conversationId?: string) => void;
  applyStreamEvent: (assistantId: string, event: ChatStreamEvent, conversationId?: string) => void;
  completeStreaming: (assistantId: string, conversationId?: string) => void;
  cancelStreaming: (assistantId?: string, conversationId?: string) => void;
  failStreaming: (assistantId: string, content?: string, conversationId?: string) => void;
  stopStreaming: () => void; sendMessage: (prompt: string, streamFactory?: ChatStreamFactory, context?: Record<string, unknown>, requestOverrides?: Pick<ChatStreamRequest, 'document' | 'documents' | 'attachments' | 'options' | 'tools' | 'use_memory' | 'context'>) => Promise<void>;
  resumeGate: (messageId: string, runId: string, decision: string, supplement?: Record<string, unknown>) => Promise<void>;
  /** 当本地 run 已结束（completed/failed）时，把会话里滞留的 Gate 记录标记为已解决。 */
  resolveStaleGate: (runId: string) => void;
  appendUploadAttachment: (attachment: ChatAttachment) => void;
  persistAssistantMessage: (
    content: string,
    structuredData: { kind: 'm7_delivery_draft'; draft: Record<string, unknown> | null },
  ) => Promise<ChatMessage>;
};

/** 遗留的全局键名；实际读写都过 `chatStorageKey()` 落到当前用户的命名空间。 */
export const CHAT_LAST_CONVERSATION_KEY = 'yunpai.chat.last-conversation-id';
const LOCAL_MESSAGE_SETS_KEY = 'yunpai.local-agent-message-sets';
export const lastSelectedConversationId = () => globalThis.localStorage?.getItem(chatStorageKey(CHAT_LAST_CONVERSATION_KEY)) ?? undefined;
const rememberConversation = (id: string) => globalThis.localStorage?.setItem(chatStorageKey(CHAT_LAST_CONVERSATION_KEY), id);
const forgetConversation = (id: string) => {
  if (lastSelectedConversationId() === id) globalThis.localStorage?.removeItem(chatStorageKey(CHAT_LAST_CONVERSATION_KEY));
};
const readLocalMessageSets = (): Record<string, ChatMessage[]> => {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(chatStorageKey(LOCAL_MESSAGE_SETS_KEY)) || '{}') as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, ChatMessage[]> : {};
  } catch {
    return {};
  }
};
const persistLocalMessages = (conversationId: string, messages: ChatMessage[]) => {
  if (import.meta.env.VITE_LOCAL_LANGGRAPH !== 'true') return;
  const stored = messages.slice(-100).map((message) => ({
    ...message,
    tools: message.tools?.map((tool) => {
      const storedTool = { ...tool };
      delete storedTool.result;
      return storedTool;
    }),
  }));
  try {
    globalThis.localStorage?.setItem(chatStorageKey(LOCAL_MESSAGE_SETS_KEY), JSON.stringify({ ...readLocalMessageSets(), [conversationId]: stored }));
  } catch {
    // History remains available in memory if browser storage is full or unavailable.
  }
};
const forgetLocalMessages = (conversationId: string) => {
  if (import.meta.env.VITE_LOCAL_LANGGRAPH !== 'true') return;
  const messageSets = readLocalMessageSets();
  delete messageSets[conversationId];
  globalThis.localStorage?.setItem(chatStorageKey(LOCAL_MESSAGE_SETS_KEY), JSON.stringify(messageSets));
};
const uid = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const streamingId = (messages: ChatMessage[]) => [...messages].reverse().find((item) => item.role === 'assistant' && item.status === 'streaming')?.id;
const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
/** 历史里步骤失败原因：`{code,message}` 或字符串（后端两种都可能）。 */
const stepErrorText = (error: unknown): string | undefined => {
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    const detail = error as { message?: unknown; code?: unknown };
    if (typeof detail.message === 'string' && detail.message.trim()) return detail.message;
    if (typeof detail.code === 'string' && detail.code.trim()) return detail.code;
  }
  return undefined;
};
/**
 * 历史回读（刷新页面）时的步骤状态归一化：
 * - `failed` → `failed`（带原因）；
 * - `blocked` + `error`（TOOL_FORBIDDEN 权限拒绝）→ `failed` + 原因，
 *   否则刷新后被拒步骤会显示「运行中」且没有原因；
 * - `blocked` 无 `error`（reviewer 未通过 → 已开人工 Gate）→ `waiting_human`；
 * - `ok` / `waiting_human` 原样，其它未知状态仍按 `running` 兜底。
 */
const toToolStepStatus = (status: string, error: unknown): ChatToolStep['status'] => {
  if (status === 'failed') return 'failed';
  if (status === 'blocked') return stepErrorText(error) ? 'failed' : 'waiting_human';
  if (status === 'ok') return 'ok';
  if (status === 'waiting_human') return 'waiting_human';
  return 'running';
};
const toMessages = (items: ChatHistoryMessage[]): ChatMessage[] => items.map((item) => ({
  id: item.id, role: item.role, content: item.content,
  status: item.status === 'completed' ? 'completed' : item.status === 'streaming' ? 'streaming' : item.run?.status === 'cancelled' ? 'cancelled' : 'failed',
  error: item.run?.error,
  attachments: item.attachments,
  structuredData: item.structured_data,
  tools: item.run?.tool_steps.map((step) => {
    const status = toToolStepStatus(step.status, step.error);
    return {
      id: step.step_id, tool: step.tool, label: step.safe_summary ?? step.tool, status,
      ...(status === 'failed' ? { error: stepErrorText(step.error) ?? '执行失败' } : {}),
      summary: step.safe_summary, durationMs: step.duration_ms,
      result: parseToolResult(step.safe_result), resultTruncated: step.result_truncated,
      dataRef: extractToolDataRef(step.tool, undefined, parseToolResult(step.safe_result)),
    };
  }),
}));

const parseToolResult = (raw?: string | null): unknown => {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const responseCode = (error: unknown): string | undefined => {
  if (!(error instanceof HttpClientError)) return undefined;
  let detail = error.error.detail;
  if (typeof detail === 'string') {
    try { detail = JSON.parse(detail); } catch { return undefined; }
  }
  if (!detail || typeof detail !== 'object') return undefined;
  const body = detail as { code?: unknown; detail?: { code?: unknown } };
  const code = body.detail?.code ?? body.code;
  return typeof code === 'string' ? code : undefined;
};

const duplicateConversationId = (error: unknown): string | undefined => {
  if (!(error instanceof ChatStreamHttpError) || error.status !== 409 || !error.payload || typeof error.payload !== 'object') return undefined;
  const payload = error.payload as { detail?: { code?: unknown; conversation_id?: unknown } };
  return payload.detail?.code === 'duplicate_client_message_id' && typeof payload.detail.conversation_id === 'string'
    ? payload.detail.conversation_id : undefined;
};

const m7TrackingTaskId = (context?: Record<string, unknown>): string | undefined => {
  const draft = context?.m7_delivery_draft;
  if (!draft || typeof draft !== 'object') return undefined;
  const taskId = (draft as Record<string, unknown>).tracking_task_id;
  return typeof taskId === 'string' && taskId.trim() ? taskId : undefined;
};

export const useChatStore = create<ChatState>((set, get) => {
  let conversationLoadSequence = 0;
  let messageLoadSequence = 0;

  const updateMessages = (conversationId: string, updater: (messages: ChatMessage[]) => ChatMessage[]) => {
    set((state) => {
      const next = updater(state.messageSets[conversationId] ?? (state.selectedConversationId === conversationId ? state.messages : []));
      persistLocalMessages(conversationId, next);
      return { messageSets: { ...state.messageSets, [conversationId]: next }, ...(state.selectedConversationId === conversationId ? { messages: next } : {}) };
    });
  };

  return {
    draft: '', sending: false, streaming: false, messages: [], activeLocalRunId: undefined, conversations: [], messageSets: {}, controllers: {}, messageNextCursors: {},
    sidebarCollapsed: globalThis.localStorage?.getItem('yunpai.chat.sidebar-collapsed') === 'true', historyLoading: false,
    historyLoadingMore: false, historyMutationPending: false,
    setDraft: (draft) => set({ draft }),
    setSidebarCollapsed: (sidebarCollapsed) => {
      globalThis.localStorage?.setItem('yunpai.chat.sidebar-collapsed', String(sidebarCollapsed));
      set({ sidebarCollapsed });
    },
    resetChat: () => {
      conversationLoadSequence += 1;
      messageLoadSequence += 1;
      Object.values(get().controllers).forEach((controller) => controller.abort());
      set({ draft: '', sending: false, streaming: false, activeAbortController: undefined, messages: [], activeLocalRunId: undefined, conversations: [], messageSets: {}, controllers: {}, selectedConversationId: undefined,
        conversationNextCursor: undefined, conversationQuery: undefined, messageNextCursors: {}, historyLoading: false, historyLoadingMore: false,
        historyError: undefined, historyMutationPending: false, historyMutationError: undefined });
    },
    newConversation: async () => {
      conversationLoadSequence += 1;
      set({ historyLoading: false, historyLoadingMore: false, historyMutationPending: true, historyMutationError: undefined, historyError: undefined });
      try {
        const conversation = await createChatConversation('新对话');
        set((state) => ({
          conversations: [conversation, ...state.conversations.filter((item) => item.id !== conversation.id)],
          messageSets: { ...state.messageSets, [conversation.id]: [] },
          selectedConversationId: conversation.id,
          messages: [],
          activeLocalRunId: undefined,
          draft: '', sending: false, streaming: false, activeAbortController: undefined,
        }));
        rememberConversation(conversation.id);
        return conversation.id;
      } catch (error) {
        const message = errorMessage(error, '新建会话失败');
        set({ historyMutationError: message });
        throw new Error(message);
      } finally {
        set({ historyMutationPending: false });
      }
    },
    loadConversations: async (q) => {
      const sequence = ++conversationLoadSequence;
      set({ historyLoading: true, historyLoadingMore: false, historyError: undefined });
      try {
        const response = await listChatConversations(q);
        if (sequence === conversationLoadSequence) set({ conversations: response.items, conversationNextCursor: response.next_cursor ?? undefined,
          conversationQuery: q, historyLoading: false });
      } catch (error) {
        if (sequence === conversationLoadSequence) set({ historyLoading: false, historyError: errorMessage(error, '会话加载失败') });
      }
    },
    loadMoreConversations: async () => {
      const { conversationNextCursor: cursor, conversationQuery: q } = get();
      if (!cursor || get().historyLoadingMore) return;
      const sequence = conversationLoadSequence;
      set({ historyLoadingMore: true, historyError: undefined });
      try {
        const response = await listChatConversations(q, cursor);
        if (sequence !== conversationLoadSequence) return;
        set((state) => {
          const existing = new Set(state.conversations.map((item) => item.id));
          return { conversations: [...state.conversations, ...response.items.filter((item) => !existing.has(item.id))],
            conversationNextCursor: response.next_cursor ?? undefined, historyLoadingMore: false };
        });
      } catch (error) {
        if (sequence === conversationLoadSequence) set({ historyLoadingMore: false, historyError: errorMessage(error, '更多会话加载失败') });
      }
    },
    selectConversation: async (id) => {
      const sequence = ++messageLoadSequence;
      const cached = get().messageSets[id] ?? (import.meta.env.VITE_LOCAL_LANGGRAPH === 'true' ? readLocalMessageSets()[id] : undefined);
      set({ selectedConversationId: id, messages: cached ?? [], activeLocalRunId: undefined, sending: Boolean(get().controllers[id]), streaming: Boolean(get().controllers[id]),
        activeAbortController: get().controllers[id], historyLoadingMore: false, historyError: undefined });
      if (get().controllers[id]) return;
      if (import.meta.env.VITE_LOCAL_LANGGRAPH === 'true') {
        const activeLocalRunId = [...(cached ?? [])].reverse().find((message) => message.runId)?.runId;
        set((state) => ({ activeLocalRunId, messageSets: { ...state.messageSets, [id]: cached ?? [] } }));
        rememberConversation(id);
        return;
      }
      try {
        const response = await getChatMessages(id);
        const messages = toMessages(response.items);
        if (sequence !== messageLoadSequence) return;
        set((state) => ({ messageSets: { ...state.messageSets, [id]: messages },
          messageNextCursors: { ...state.messageNextCursors, [id]: response.next_cursor ?? undefined },
          ...(state.selectedConversationId === id ? { messages } : {}) }));
        rememberConversation(id);
      } catch (error) {
        if (sequence === messageLoadSequence) set({ historyError: errorMessage(error, '消息加载失败') });
      }
    },
    loadMoreMessages: async (requestedId) => {
      const id = requestedId ?? get().selectedConversationId;
      if (!id || get().historyLoadingMore) return;
      const cursor = get().messageNextCursors[id];
      if (!cursor) return;
      const sequence = messageLoadSequence;
      set({ historyLoadingMore: true, historyError: undefined });
      try {
        const response = await getChatMessages(id, cursor);
        if (sequence !== messageLoadSequence) return;
        const nextMessages = toMessages(response.items);
        set((state) => {
          const existing = new Set((state.messageSets[id] ?? []).map((item) => item.id));
          const messages = [...(state.messageSets[id] ?? []), ...nextMessages.filter((item) => !existing.has(item.id))];
          return { messageSets: { ...state.messageSets, [id]: messages },
            messageNextCursors: { ...state.messageNextCursors, [id]: response.next_cursor ?? undefined }, historyLoadingMore: false,
            ...(state.selectedConversationId === id ? { messages } : {}) };
        });
      } catch (error) {
        if (sequence === messageLoadSequence) set({ historyLoadingMore: false, historyError: errorMessage(error, '更多消息加载失败') });
      }
    },
    renameConversation: async (conversation, title) => {
      conversationLoadSequence += 1;
      set({ historyLoading: false, historyMutationPending: true, historyMutationError: undefined });
      try {
        const updated = await renameChatConversation(conversation.id, title, conversation.version);
        set((state) => ({ conversations: state.conversations.map((item) => item.id === updated.id ? updated : item) }));
      } catch (error) {
        const conflict = error instanceof HttpClientError && error.error.status === 409;
        if (conflict) await get().loadConversations();
        const message = conflict ? '会话已被其他使用者更新，请基于最新标题重试。' : errorMessage(error, '重命名失败');
        set({ historyMutationError: message });
        throw new Error(message);
      } finally {
        set({ historyMutationPending: false });
      }
    },
    deleteConversation: async (conversation) => {
      conversationLoadSequence += 1;
      set({ historyLoading: false, historyMutationPending: true, historyMutationError: undefined });
      try {
        await deleteChatConversation(conversation.id, conversation.version);
        forgetConversation(conversation.id);
        forgetLocalMessages(conversation.id);
        set((state) => ({ conversations: state.conversations.filter((item) => item.id !== conversation.id),
          ...(state.selectedConversationId === conversation.id ? { selectedConversationId: undefined, messages: [] } : {}) }));
      } catch (error) {
        const code = responseCode(error);
        if (code === 'version_conflict') await get().loadConversations(get().conversationQuery);
        const message = code === 'active_run'
          ? '会话仍在生成，请先返回该会话停止生成后再删除。'
          : code === 'version_conflict'
            ? '会话已被其他使用者更新，请确认最新状态后重新删除。'
            : errorMessage(error, '删除会话失败');
        set({ historyMutationError: message });
        throw new Error(message);
      } finally {
        set({ historyMutationPending: false });
      }
    },
    startStreaming: (prompt, assistantId = uid('assistant'), userId = uid('user'), conversationId = get().selectedConversationId ?? uid('draft')) => {
      messageLoadSequence += 1;
      if (!get().selectedConversationId) set({ selectedConversationId: conversationId });
      updateMessages(conversationId, (messages) => [...messages,
        { id: userId, role: 'user', content: prompt, status: 'completed' },
        { id: assistantId, role: 'assistant', content: '', status: 'streaming' }]);
      set({ draft: '', sending: true, streaming: true });
      return assistantId;
    },
    appendStreamingChunk: (assistantId, chunk, done = false, conversationId = get().selectedConversationId) => {
      if (!conversationId) return;
      updateMessages(conversationId, (messages) => messages.map((item) => item.id === assistantId ? { ...item, content: item.content + chunk, status: done ? 'completed' : 'streaming' } : item));
    },
    applyStreamEvent: (assistantId, event, conversationId = get().selectedConversationId) => {
      if (!conversationId) return;
      if (event.type === 'message_start' && event.run_id) {
        set({ activeLocalRunId: event.run_id });
        return updateMessages(conversationId, (messages) => messages.map((item) => item.id === assistantId ? { ...item, runId: event.run_id } : item));
      }
      if (event.type === 'delta') return get().appendStreamingChunk(assistantId, event.content, false, conversationId);
      if (event.type === 'error') return updateMessages(conversationId, (messages) => messages.map((item) => item.id === assistantId ? { ...item, status: 'failed', error: event.message, content: item.content || event.message } : item));
      if (event.type === 'message_done') {
        if (event.content) get().appendStreamingChunk(assistantId, event.content, false, conversationId);
        return event.finish_reason === 'cancelled' ? get().cancelStreaming(assistantId, conversationId) : event.finish_reason === 'error' ? get().failStreaming(assistantId, undefined, conversationId) : get().completeStreaming(assistantId, conversationId);
      }
      if (event.type === 'gate_opened') {
        set({ activeLocalRunId: event.run_id });
        return updateMessages(conversationId, (messages) => messages.map((item) => {
          if (item.id !== assistantId) return item;
          const gateTool = typeof event.gate.tool === 'string' ? event.gate.tool : '';
          const tools = [...(item.tools ?? [])];
          let target = -1;
          for (let index = tools.length - 1; index >= 0; index -= 1) {
            const step = tools[index];
            if (step && step.status === 'running' && (!gateTool || step.tool === gateTool)) { target = index; break; }
          }
          if (target < 0) for (let index = tools.length - 1; index >= 0; index -= 1) {
            const step = tools[index];
            if (step?.status === 'running') { target = index; break; }
          }
          const targetStep = target >= 0 ? tools[target] : undefined;
          if (targetStep) tools[target] = { ...targetStep, status: 'waiting_human', summary: String(event.gate.message || '等待人工输入') };
          return { ...item, tools, gate: { runId: event.run_id, gate: event.gate, status: 'pending' } };
        }));
      }
      if (event.type === 'memory_recall') return updateMessages(conversationId, (messages) => messages.map((item) => item.id === assistantId ? { ...item, memoryRecall: { similarEpisodes: event.similar_episodes, recentSession: event.recent_session } } : item));
      if (event.type === 'tool_start') return updateMessages(conversationId, (messages) => messages.map((item) => item.id === assistantId ? { ...item, tools: [...(item.tools ?? []), { id: event.step_id, tool: event.tool, label: event.label, status: 'running' }] } : item));
      if (event.type === 'tool_result' || event.type === 'tool_error') updateMessages(conversationId, (messages) => messages.map((item) => item.id === assistantId ? { ...item, tools: (item.tools ?? []).map((step) => step.id === event.step_id ? { ...step, status: event.type === 'tool_result' ? 'ok' : 'failed', durationMs: event.duration_ms, summary: event.type === 'tool_result' ? event.summary : step.summary, error: event.type === 'tool_error' ? event.error : step.error, ...(event.type === 'tool_result' ? { result: event.result, resultTruncated: event.result_truncated, dataRef: event.data_ref } : {}) } : step) } : item));
    },
    completeStreaming: (assistantId, conversationId = get().selectedConversationId) => {
      if (!conversationId) return;
      updateMessages(conversationId, (messages) => messages.map((item) => item.id === assistantId && item.status !== 'failed' ? { ...item, status: 'completed' } : item));
      set((state) => { const controllers = { ...state.controllers }; delete controllers[conversationId]; return { controllers, ...(state.selectedConversationId === conversationId ? { sending: false, streaming: false, activeAbortController: undefined } : {}) }; });
    },
    cancelStreaming: (assistantId, conversationId = get().selectedConversationId) => {
      if (!conversationId) return;
      updateMessages(conversationId, (messages) => messages.map((item) => assistantId && item.id === assistantId && item.status === 'streaming' ? { ...item, status: 'cancelled', content: item.content || '已停止生成。' } : item));
      set((state) => { const controllers = { ...state.controllers }; delete controllers[conversationId]; return { controllers, ...(state.selectedConversationId === conversationId ? { sending: false, streaming: false, activeAbortController: undefined } : {}) }; });
    },
    failStreaming: (assistantId, content = '流式输出失败。', conversationId = get().selectedConversationId) => {
      if (!conversationId) return;
      updateMessages(conversationId, (messages) => messages.map((item) => item.id === assistantId ? { ...item, status: 'failed', content: item.content || content } : item));
      set((state) => { const controllers = { ...state.controllers }; delete controllers[conversationId]; return { controllers, ...(state.selectedConversationId === conversationId ? { sending: false, streaming: false, activeAbortController: undefined } : {}) }; });
    },
    stopStreaming: () => {
      const id = get().selectedConversationId;
      if (!id) return;
      get().controllers[id]?.abort();
      get().cancelStreaming(streamingId(get().messageSets[id] ?? get().messages), id);
    },
    resumeGate: async (messageId, runId, decision, supplement) => {
      const conversationId = get().selectedConversationId;
      if (!conversationId) return;
      const controller = new AbortController();
      // 保留 Gate 记录作为会话审计；新 Gate 到达时 applyStreamEvent 会覆盖为新的待处理记录。
      const decisionStatus: 'approved' | 'retrying' | 'rejected' = decision === 'reject' ? 'rejected' : decision === 'retry' ? 'retrying' : 'approved';
      updateMessages(conversationId, (messages) => messages.map((item) => item.id === messageId && item.gate
        ? { ...item, gate: { ...item.gate, status: decisionStatus } }
        : item));
      set((state) => ({ controllers: { ...state.controllers, [conversationId]: controller }, sending: true, streaming: true, activeAbortController: controller }));
      try { for await (const event of resumeLocalRunStream(runId, decision, supplement, { signal: controller.signal })) get().applyStreamEvent(messageId, event, conversationId); get().completeStreaming(messageId, conversationId); }
      catch (error) {
        if (controller.signal.aborted) get().cancelStreaming(messageId, conversationId);
        else {
          updateMessages(conversationId, (messages) => messages.map((item) => item.id === messageId && item.gate
            ? { ...item, gate: { ...item.gate, status: 'error' } }
            : item));
          get().failStreaming(messageId, error instanceof Error ? error.message : 'Gate 恢复失败', conversationId);
        }
      }
    },
    resolveStaleGate: (runId) => {
      // run 已结束（completed/failed）但会话消息里的 Gate 仍标记 pending/error：
      // 视为已解决，避免右下角通知与卡片继续报旧错误（如「计划不存在」）。
      // 在所有会话的消息集中匹配，不只在当前选中会话。
      set((state) => {
        const clean = (messages: ChatMessage[]): ChatMessage[] => messages.map((item) => {
          if (item.gate && item.gate.runId === runId && (!item.gate.status || item.gate.status === 'pending' || item.gate.status === 'error')) {
            return { ...item, gate: { ...item.gate, status: 'resolved' as const } };
          }
          return item;
        });
        const messageSets = Object.fromEntries(
          Object.entries(state.messageSets).map(([id, messages]) => [id, clean(messages)]),
        );
        for (const [id, messages] of Object.entries(messageSets)) persistLocalMessages(id, messages);
        const nextMessages = state.selectedConversationId ? clean(state.messages) : undefined;
        return nextMessages ? { messageSets, messages: nextMessages } : { messageSets };
      });
    },
    sendMessage: async (prompt, streamFactory = streamChatFromOrchestrator, context, requestOverrides) => {
      const value = prompt.trim();
      if (!value) return;
      let conversationId: string = get().selectedConversationId ?? uid('draft');
      if (import.meta.env.VITE_LOCAL_LANGGRAPH === 'true' && (!conversationId || conversationId.startsWith('draft-'))) {
        conversationId = await get().newConversation();
      }
      if (get().controllers[conversationId]) return;
      const existingConversation = get().conversations.find((item) => item.id === conversationId);
      if (existingConversation?.title_source === 'auto' && existingConversation.title === '新对话') {
        const title = buildConversationSummary(value);
        saveLocalConversationSummary(conversationId, title);
        set((state) => ({ conversations: state.conversations.map((item) => item.id === conversationId ? { ...item, title, updated_at: new Date().toISOString(), last_message_at: new Date().toISOString() } : item) }));
      }
      const assistantId = get().startStreaming(value, undefined, undefined, conversationId);
      const controller = new AbortController();
      set((state) => ({ controllers: { ...state.controllers, [conversationId]: controller }, ...(state.selectedConversationId === conversationId ? { activeAbortController: controller } : {}) }));
      try {
        const stream = streamFactory === streamChatFromOrchestrator
          ? streamChatFromOrchestrator({
              message: value,
              conversation_id: import.meta.env.VITE_LOCAL_LANGGRAPH === 'true' ? conversationId : (conversationId.startsWith('draft-') ? undefined : conversationId),
              client_message_id: uuidV4(),
              ...requestOverrides,
              ...(context || requestOverrides?.context ? { context: { page: 'assistant', ...(requestOverrides?.context ?? {}), ...(context ?? {}) } } : {}),
            }, { signal: controller.signal, trackingTaskId: m7TrackingTaskId(context) })
          : streamFactory(value, { signal: controller.signal });
        for await (const item of stream) {
          if (isChatStreamEvent(item)) {
            if (item.type === 'message_start' && item.conversation_id !== conversationId) {
              const oldId = conversationId; conversationId = item.conversation_id;
              conversationLoadSequence += 1;
              set((state) => {
                const sourceMessages = state.messageSets[oldId] ?? [];
                const targetMessages = state.messageSets[conversationId];
                const collision = Boolean(targetMessages && oldId !== conversationId);
                const migratedMessages = collision
                  ? [...(targetMessages ?? []), ...sourceMessages.filter((source) => !(targetMessages ?? []).some((target) => target.id === source.id))]
                  : sourceMessages;
                const messageSets = { ...state.messageSets, [conversationId]: migratedMessages }; delete messageSets[oldId];
                const controllers = { ...state.controllers, [conversationId]: controller }; delete controllers[oldId];
                const exists = state.conversations.some((entry) => entry.id === conversationId);
                const now = new Date().toISOString();
                const conversations = exists ? state.conversations : [{
                  id: conversationId,
                  title: item.conversation_title ?? value.slice(0, 120),
                  title_source: item.conversation_title_source ?? 'auto' as const,
                  status: 'active' as const,
                  created_at: now,
                  updated_at: now,
                  last_message_at: now,
                  version: item.conversation_version ?? 2,
                }, ...state.conversations];
                return { messageSets, controllers, conversations, historyLoading: false,
                  ...(collision ? { historyError: '服务端返回了已被其他会话使用的 ID，已合并本地消息，请刷新历史核对。' } : {}),
                  ...(state.selectedConversationId === oldId ? { selectedConversationId: conversationId, messages: messageSets[conversationId], activeAbortController: controller } : {}) };
              });
              rememberConversation(conversationId);
            }
            if (item.type === 'message_start') {
              set((state) => ({ conversations: state.conversations.map((entry) => entry.id === conversationId
                ? {
                    ...entry,
                    ...(item.conversation_version ? { version: item.conversation_version } : {}),
                    ...(item.conversation_title ? { title: item.conversation_title } : {}),
                    ...(item.conversation_title_source ? { title_source: item.conversation_title_source } : {}),
                    last_message_at: item.created_at,
                    updated_at: item.created_at,
                  }
                : entry) }));
            }
            get().applyStreamEvent(assistantId, item, conversationId);
          } else {
            get().appendStreamingChunk(assistantId, item.content, item.done, conversationId);
            if (item.done) get().completeStreaming(assistantId, conversationId);
          }
        }
        if ((get().messageSets[conversationId] ?? []).find((item) => item.id === assistantId)?.status === 'streaming') get().completeStreaming(assistantId, conversationId);
      } catch (error) {
        const canonicalId = duplicateConversationId(error);
        if (canonicalId) {
          const localId = conversationId;
          conversationId = canonicalId;
          set((state) => {
            const messageSets = { ...state.messageSets };
            delete messageSets[localId];
            const controllers = { ...state.controllers };
            delete controllers[localId];
            delete controllers[canonicalId];
            return { messageSets, controllers,
              ...(state.selectedConversationId === localId ? { selectedConversationId: canonicalId, messages: [], sending: false,
                streaming: false, activeAbortController: undefined } : {}) };
          });
          await get().loadConversations(get().conversationQuery);
          await get().selectConversation(canonicalId);
          set({ historyError: '检测到重复提交，已加载服务端保存的会话内容。' });
        } else if (controller.signal.aborted) get().cancelStreaming(assistantId, conversationId);
        else get().failStreaming(assistantId, error instanceof Error ? error.message : '流式输出失败。', conversationId);
      }
    },
    appendUploadAttachment: (attachment) => {
      const conversationId = get().selectedConversationId ?? uid('draft');
      const id = uid('user');
      updateMessages(conversationId, (messages) => [
        ...messages,
        { id, role: 'user', content: `上传了文件：${attachment.name}`, status: 'completed', attachments: [attachment] },
      ]);
      if (!get().selectedConversationId) {
        set({ selectedConversationId: conversationId });
      }
    },
    persistAssistantMessage: async (content, structuredData) => {
      const value = content.trim();
      if (!value) throw new Error('消息内容不能为空');
      let conversationId = get().selectedConversationId;
      if (!conversationId || conversationId.startsWith('draft-')) {
        conversationId = await get().newConversation();
      }
      const response = await createLocalAssistantMessage(conversationId, value, structuredData);
      const persisted = toMessages([response.message])[0];
      if (!persisted) throw new Error('服务端未返回已保存的消息');
      updateMessages(conversationId, (messages) => [
        ...messages.filter((item) => item.id !== persisted.id),
        persisted,
      ]);
      set((state) => ({
        conversations: [
          response.conversation,
          ...state.conversations.filter((item) => item.id !== response.conversation.id),
        ],
      }));
      rememberConversation(conversationId);
      return persisted;
    },
  };
});

// 登录 / 退出 / 切换租户会改变本地存储命名空间：清掉内存里的会话，
// 避免上一个账号的会话列表或消息在页面内（刷新前）继续可见。
onChatStorageScopeChange(() => useChatStore.getState().resetChat());
