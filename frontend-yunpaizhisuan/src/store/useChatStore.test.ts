import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from './useChatStore';
import { ChatStreamHttpError } from '../services/chatApi';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

describe('useChatStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useChatStore.getState().resetChat();
  });

  it('streams assistant chunks into the active message list', async () => {
    async function* stream() {
      yield { id: 'chunk-1', content: '排程', done: false };
      yield { id: 'chunk-2', content: '存在高风险。', done: true };
    }

    await act(async () => {
      await useChatStore.getState().sendMessage(' 查看排程风险 ', stream);
    });

    const state = useChatStore.getState();
    expect(state.sending).toBe(false);
    expect(state.streaming).toBe(false);
    expect(state.draft).toBe('');
    expect(state.messages).toMatchObject([
      { role: 'user', content: '查看排程风险', status: 'completed' },
      { role: 'assistant', content: '排程存在高风险。', status: 'completed' },
    ]);
  });

  it('marks the assistant message failed when streaming throws', async () => {
    async function* failingStream() {
      yield { id: 'chunk-1', content: '', done: false };
      throw new Error('stream failed');
    }

    await act(async () => {
      await useChatStore.getState().sendMessage('检查合同风险', failingStream);
    });

    expect(useChatStore.getState().messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'failed',
      content: 'stream failed',
    });
  });

  it('applies stream events, memory recall and tool steps', async () => {
    async function* stream() {
      yield {
        type: 'message_start' as const,
        message_id: 'm1',
        session_id: 's1',
        conversation_id: 'assistant',
        created_at: 'now',
        run_id: 'run-local-test-001',
        conversation_version: 2,
        conversation_title: '查看排程',
        conversation_title_source: 'auto' as const,
      };
      yield { type: 'memory_recall' as const, similar_episodes: 2, recent_session: 1 };
      yield { type: 'tool_start' as const, message_id: 'm1', step_id: 'step-1', tool: 'list_m5_schedules', label: '查询排程列表' };
      yield {
        type: 'tool_result' as const,
        message_id: 'm1',
        step_id: 'step-1',
        tool: 'list_m5_schedules',
        status: 'ok' as const,
        duration_ms: 12.5,
        summary: '找到 3 个版本',
      };
      yield { type: 'delta' as const, message_id: 'm1', content: '排程正常。' };
      yield { type: 'message_done' as const, message_id: 'm1', finish_reason: 'stop' as const };
    }

    await act(async () => {
      await useChatStore.getState().sendMessage('查看排程', stream);
    });

    const assistant = useChatStore.getState().messages.at(-1);
    expect(assistant).toMatchObject({
      role: 'assistant',
      status: 'completed',
      content: '排程正常。',
      memoryRecall: { similarEpisodes: 2, recentSession: 1 },
      tools: [{ id: 'step-1', status: 'ok', summary: '找到 3 个版本' }],
    });
    expect(useChatStore.getState().conversations).toMatchObject([
      { id: 'assistant', title: '查看排程', title_source: 'auto', version: 2 },
    ]);
    expect(useChatStore.getState().activeLocalRunId).toBe('run-local-test-001');
  });

  it('closes a running tool step when the graph pauses at a human gate', () => {
    const assistantId = useChatStore.getState().startStreaming('执行 M2');
    useChatStore.getState().applyStreamEvent(assistantId, {
      type: 'tool_start', message_id: assistantId, step_id: 'm2-step', tool: 'run_bom_sop_workflow', label: 'M2 BOM/SOP',
    });
    useChatStore.getState().applyStreamEvent(assistantId, {
      type: 'gate_opened', message_id: assistantId, run_id: 'run-m2', gate: {
        type: 'data', module: 'm2', tool: 'run_bom_sop_workflow', message: '缺少权威输入', actions: ['补充数据', '终止'],
      },
    });

    expect(useChatStore.getState().messages.at(-1)).toMatchObject({
      gate: { status: 'pending', runId: 'run-m2' },
      tools: [{ id: 'm2-step', status: 'waiting_human', summary: '缺少权威输入' }],
    });
  });

  it('marks the active message cancelled when stopped', async () => {
    let capturedSignal: AbortSignal | undefined;
    async function* stream(_prompt: string, options?: { signal?: AbortSignal }) {
      capturedSignal = options?.signal;
      yield { id: 'chunk-1', content: '排程', done: false };
      await new Promise<void>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    }

    const promise = useChatStore.getState().sendMessage('停止生成', stream);

    await waitFor(() => expect(capturedSignal).toBeDefined());
    act(() => useChatStore.getState().stopStreaming());
    await act(async () => {
      await promise;
    });

    expect(useChatStore.getState().messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'cancelled',
      content: '排程',
    });
  });

  it('creates a server conversation immediately for route activation', async () => {
    const conversation = {
      id: '11111111-1111-4111-8111-111111111111', title: '新对话', title_source: 'manual' as const,
      status: 'active' as const, created_at: '2026-07-21T00:00:00Z', updated_at: '2026-07-21T00:00:00Z',
      last_message_at: '2026-07-21T00:00:00Z', version: 1,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(conversation, 201)));

    await act(async () => useChatStore.getState().newConversation());

    expect(useChatStore.getState()).toMatchObject({
      selectedConversationId: conversation.id,
      messages: [],
      conversations: [conversation],
      messageSets: { [conversation.id]: [] },
      historyMutationPending: false,
    });
  });

  it('replaces the visible chat with authoritative server history when selected', async () => {
    const conversationId = '22222222-2222-4222-8222-222222222222';
    useChatStore.setState({
      selectedConversationId: 'current',
      messages: [{ id: 'current-message', role: 'user', content: '当前内容', status: 'completed' }],
      messageSets: { current: [{ id: 'current-message', role: 'user', content: '当前内容', status: 'completed' }] },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      items: [{ id: 'history-message', role: 'user', content: '历史内容', status: 'completed', created_at: '2026-07-21T00:00:00Z', run: null }],
      next_cursor: null,
    })));

    await act(async () => useChatStore.getState().selectConversation(conversationId));

    expect(useChatStore.getState().selectedConversationId).toBe(conversationId);
    expect(useChatStore.getState().messages).toMatchObject([{ id: 'history-message', content: '历史内容' }]);
    expect(localStorage.getItem('yunpai.chat.last-conversation-id')).toBe(conversationId);
  });

  it('persists an M7 workflow message and keeps structured draft data in history state', async () => {
    const conversationId = '12121212-1212-4212-8212-121212121212';
    const conversation = {
      id: conversationId, title: '送货签收', title_source: 'manual' as const, status: 'active' as const,
      created_at: '2026-08-26T00:00:00Z', updated_at: '2026-08-26T00:00:01Z', version: 2,
    };
    useChatStore.setState({ selectedConversationId: conversationId, conversations: [conversation] });
    const structuredData = {
      kind: 'm7_delivery_draft' as const,
      draft: { m0_batch_id: 'batch-1', tracking_task_id: 'task-1' },
    };
    const fetchMock = vi.fn().mockResolvedValue(response({
      message: {
        id: 'persisted-message', role: 'assistant', content: '识别完成', status: 'completed',
        structured_data: structuredData, created_at: '2026-08-26T00:00:01Z', run: null,
      },
      conversation,
    }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      await useChatStore.getState().persistAssistantMessage('识别完成', structuredData);
    });

    expect(useChatStore.getState().messages.at(-1)).toMatchObject({
      id: 'persisted-message',
      content: '识别完成',
      structuredData,
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/local-assistant-messages');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      source: 'm7_delivery_workflow',
      structured_data: structuredData,
    });
  });

  it('does not let a delayed empty history response clear a live stream', async () => {
    const conversationId = '29292929-2929-4929-8929-292929292929';
    let releaseHistory: ((value: Response) => void) | undefined;
    const delayedHistory = new Promise<Response>((resolve) => { releaseHistory = resolve; });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => delayedHistory));

    const historyRequest = useChatStore.getState().selectConversation(conversationId);
    async function* stream() {
      yield { id: 'chunk-1', content: '实时回复', done: false };
      yield { id: 'chunk-2', content: '仍然可见', done: true };
    }
    await act(async () => {
      await useChatStore.getState().sendMessage('实时问题', stream);
    });

    releaseHistory?.(response({ items: [], next_cursor: null }));
    await act(async () => {
      await historyRequest;
    });

    expect(useChatStore.getState().messages).toMatchObject([
      { role: 'user', content: '实时问题', status: 'completed' },
      { role: 'assistant', content: '实时回复仍然可见', status: 'completed' },
    ]);
  });

  it('keeps the newest conversation-list response when requests finish out of order', async () => {
    let resolveFirst: ((value: Response) => void) | undefined;
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const newest = {
      id: '33333333-3333-4333-8333-333333333333', title: '最新结果', title_source: 'manual' as const,
      status: 'active' as const, created_at: '2026-07-21T00:00:00Z', updated_at: '2026-07-21T00:00:00Z', version: 1,
    };
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce(response({ items: [newest], next_cursor: null })));

    const staleRequest = useChatStore.getState().loadConversations('旧查询');
    await useChatStore.getState().loadConversations('新查询');
    resolveFirst?.(response({ items: [], next_cursor: null }));
    await staleRequest;

    expect(useChatStore.getState().conversations).toEqual([newest]);
  });

  it('refreshes the shared list and exposes an actionable rename conflict', async () => {
    const stale = {
      id: '44444444-4444-4444-8444-444444444444', title: '旧标题', title_source: 'manual' as const,
      status: 'active' as const, created_at: '2026-07-21T00:00:00Z', updated_at: '2026-07-21T00:00:00Z', version: 1,
    };
    const latest = { ...stale, title: '其他使用者的标题', version: 2 };
    useChatStore.setState({ conversations: [stale] });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ detail: { code: 'version_conflict' } }, 409))
      .mockResolvedValueOnce(response({ items: [latest], next_cursor: null })));

    await expect(useChatStore.getState().renameConversation(stale, '我的标题'))
      .rejects.toThrow('会话已被其他使用者更新');

    expect(useChatStore.getState().conversations).toEqual([latest]);
    expect(useChatStore.getState().historyMutationError).toContain('基于最新标题重试');
  });

  it('consumes conversation and message cursors without duplicating records', async () => {
    const first = {
      id: '55555555-5555-4555-8555-555555555555', title: '第一页', title_source: 'manual' as const,
      status: 'active' as const, created_at: '2026-07-21T00:00:00Z', updated_at: '2026-07-21T00:00:00Z', version: 1,
    };
    const second = { ...first, id: '66666666-6666-4666-8666-666666666666', title: '第二页' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ items: [first], next_cursor: 'conversation-cursor' }))
      .mockResolvedValueOnce(response({ items: [first, second], next_cursor: null }))
      .mockResolvedValueOnce(response({ items: [{ id: 'm1', role: 'user', content: '一', status: 'completed', created_at: 'now', run: null }], next_cursor: 'message-cursor' }))
      .mockResolvedValueOnce(response({ items: [{ id: 'm2', role: 'assistant', content: '二', status: 'completed', created_at: 'later', run: null }], next_cursor: null }));
    vi.stubGlobal('fetch', fetchMock);

    await useChatStore.getState().loadConversations();
    await useChatStore.getState().loadMoreConversations();
    await useChatStore.getState().selectConversation(first.id);
    await useChatStore.getState().loadMoreMessages(first.id);

    expect(useChatStore.getState().conversations.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(useChatStore.getState().messages.map((item) => item.id)).toEqual(['m1', 'm2']);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('cursor=conversation-cursor');
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain('cursor=message-cursor');
  });

  it('reloads canonical history after a duplicate stream submission', async () => {
    const canonicalId = '77777777-7777-4777-8777-777777777777';
    const conversation = { id: canonicalId, title: '服务端会话', title_source: 'auto' as const, status: 'active' as const,
      created_at: 'now', updated_at: 'now', version: 2 };
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ items: [conversation], next_cursor: null }))
      .mockResolvedValueOnce(response({ items: [{ id: 'canonical-message', role: 'assistant', content: '已保存', status: 'completed', created_at: 'now', run: null }], next_cursor: null })));
    async function* duplicateStream() {
      yield* [];
      throw new ChatStreamHttpError(409, 'duplicate', { detail: { code: 'duplicate_client_message_id', conversation_id: canonicalId,
        user_message_id: 'user-id', assistant_message_id: 'assistant-id', run_id: 'run-id' } });
    }

    await useChatStore.getState().sendMessage('重复请求', duplicateStream);

    expect(useChatStore.getState()).toMatchObject({ selectedConversationId: canonicalId, sending: false, streaming: false });
    expect(useChatStore.getState().messages).toMatchObject([{ id: 'canonical-message', content: '已保存' }]);
    expect(useChatStore.getState().historyError).toContain('已加载服务端');
  });

  it('distinguishes active-run and stale-version delete conflicts', async () => {
    const conversation = { id: '88888888-8888-4888-8888-888888888888', title: '待删除', title_source: 'manual' as const,
      status: 'active' as const, created_at: 'now', updated_at: 'now', version: 1 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ detail: { code: 'active_run' } }, 409)));
    await expect(useChatStore.getState().deleteConversation(conversation)).rejects.toThrow('仍在生成');

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ detail: { code: 'version_conflict' } }, 409))
      .mockResolvedValueOnce(response({ items: [{ ...conversation, version: 2 }], next_cursor: null })));
    await expect(useChatStore.getState().deleteConversation(conversation)).rejects.toThrow('确认最新状态');
    expect(useChatStore.getState().conversations[0]?.version).toBe(2);
  });
});
