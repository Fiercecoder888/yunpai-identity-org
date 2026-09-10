import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChatStreamHttpError,
  ChatStreamParseError,
  type ChatStreamEvent,
  parseNdjsonChatEvent,
  streamChatFromOrchestrator,
} from './chatApi';

const encoder = new TextEncoder();

function streamFromChunks(chunks: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

describe('chatApi NDJSON stream client', () => {
  it('requests the orchestrator stream route through the unified gateway', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        streamFromChunks([
          '{"type":"message_start","message_id":"m1","session_id":"s1","conversation_id":"assistant","created_at":"now","conversation_version":2,"conversation_title":"排程风险","conversation_title_source":"auto"}\n',
          '{"type":"delta","message_id":"m1","content":"排程"}\n',
          '{"type":"message_done","message_id":"m1","finish_reason":"stop"}\n',
        ]),
        { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } },
      ),
    ) as typeof fetch;

    const received: ChatStreamEvent[] = [];
    for await (const event of streamChatFromOrchestrator('查看排程', {
      fetchImpl,
      trackingTaskId: 'task-m7-delivery-1',
    })) {
      received.push(event);
    }

    expect(fetchImpl).toHaveBeenCalledWith('/api/orchestrator/chat/stream', expect.objectContaining({ method: 'POST' }));
    expect(fetchImpl).toHaveBeenCalledWith('/api/orchestrator/chat/stream', expect.objectContaining({
      headers: expect.objectContaining({ 'X-Yunpai-Task-ID': 'task-m7-delivery-1' }),
    }));
    expect(received.map((event) => event.type)).toEqual(['message_start', 'delta', 'message_done']);
    expect(received[0]).toMatchObject({
      type: 'message_start',
      conversation_title: '排程风险',
      conversation_title_source: 'auto',
    });
    expect(received[1]).toMatchObject({ type: 'delta', content: '排程' });
  });

  it('parses NDJSON split across chunks and tool events', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        streamFromChunks([
          '{"type":"tool_start","message_id":"m1","step_id":"s1","tool":"list_m5_schedules","label":"查询排程',
          '列表"}\n{"type":"tool_result","message_id":"m1","step_id":"s1","tool":"list_m5_schedules","status":"ok","duration_ms":3.5,"summary":"找到 3 个版本"}\n',
        ]),
        { status: 200 },
      ),
    ) as typeof fetch;

    const received: ChatStreamEvent[] = [];
    for await (const event of streamChatFromOrchestrator('查排程', { fetchImpl })) {
      received.push(event);
    }

    expect(received).toEqual([
      expect.objectContaining({ type: 'tool_start', label: '查询排程列表' }),
      expect.objectContaining({ type: 'tool_result', summary: '找到 3 个版本' }),
    ]);
  });

  it('parses tool_result data_ref for BOM/drawing structured data', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        streamFromChunks([
          '{"type":"tool_result","message_id":"m1","step_id":"s1","tool":"generate_m2_bom_controlled","status":"ok","duration_ms":12,"summary":"工具调用成功","data_ref":{"kind":"bom","title":"BOM-FG-01","summary":"共 2 行 BOM 明细","rows":[{"component_item":"CBL-01","qty_per":1},{"component_item":"PKG-01","qty_per":1}]}}\n',
          '{"type":"tool_result","message_id":"m1","step_id":"s2","tool":"get_m1_document","status":"ok","duration_ms":5,"summary":"已识别","data_ref":{"kind":"drawing","title":"外壳图纸.png","summary":"工程图纸原文件预览","file_url":"/api/m1/files/task-dwg-1"}}\n',
        ]),
        { status: 200 },
      ),
    ) as typeof fetch;

    const received: ChatStreamEvent[] = [];
    for await (const event of streamChatFromOrchestrator('生成 BOM', { fetchImpl })) {
      received.push(event);
    }

    expect(received[0]).toMatchObject({
      type: 'tool_result',
      data_ref: {
        kind: 'bom',
        title: 'BOM-FG-01',
        rows: [
          { component_item: 'CBL-01', qty_per: 1 },
          { component_item: 'PKG-01', qty_per: 1 },
        ],
      },
    });
    expect(received[1]).toMatchObject({
      type: 'tool_result',
      data_ref: { kind: 'drawing', title: '外壳图纸.png', file_url: '/api/m1/files/task-dwg-1' },
    });
  });

  it('rejects tool_result with invalid data_ref kind', () => {
    expect(() =>
      parseNdjsonChatEvent(
        '{"type":"tool_result","message_id":"m1","step_id":"s1","tool":"lookup","status":"ok","duration_ms":1,"summary":"ok","data_ref":{"kind":"spreadsheet","title":"x"}}',
      ),
    ).toThrow(ChatStreamParseError);
  });

  it('passes AbortController signal to fetch', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      throw new DOMException('Aborted', 'AbortError');
    }) as typeof fetch;

    await expect(async () => {
      for await (const event of streamChatFromOrchestrator('停止', { fetchImpl, signal: controller.signal })) {
        void event;
      }
    }).rejects.toThrow('Aborted');
  });

  it('throws typed errors for non-2xx and malformed NDJSON', async () => {
    const httpFetch = vi.fn(async () => new Response('down', { status: 503 })) as typeof fetch;
    await expect(async () => {
      for await (const event of streamChatFromOrchestrator('x', { fetchImpl: httpFetch })) {
        void event;
      }
    }).rejects.toBeInstanceOf(ChatStreamHttpError);

    const parseFetch = vi.fn(async () => new Response(streamFromChunks(['{bad}\n']), { status: 200 })) as typeof fetch;
    await expect(async () => {
      for await (const event of streamChatFromOrchestrator('x', { fetchImpl: parseFetch })) {
        void event;
      }
    }).rejects.toBeInstanceOf(ChatStreamParseError);

    const networkFetch = vi.fn(async () => {
      throw new TypeError('network failed');
    }) as typeof fetch;
    await expect(async () => {
      for await (const event of streamChatFromOrchestrator('x', { fetchImpl: networkFetch })) {
        void event;
      }
    }).rejects.toThrow('network failed');
  });

  it('rejects invalid event objects', () => {
    expect(parseNdjsonChatEvent('')).toBeNull();
    expect(() => parseNdjsonChatEvent('[]')).toThrow(ChatStreamParseError);
    expect(() => parseNdjsonChatEvent('{"type":"delta","message_id":"m1"}')).toThrow(/content/);
    expect(() => parseNdjsonChatEvent('{"type":"message_start","message_id":"m1"}')).toThrow(/session_id/);
    expect(() => parseNdjsonChatEvent('{"type":"message_done","message_id":"m1","finish_reason":"later"}')).toThrow(
      /finish_reason/,
    );
    expect(() => parseNdjsonChatEvent('{"type":"unknown","message_id":"m1"}')).toThrow(/unknown/);
    expect(() =>
      parseNdjsonChatEvent(
        '{"type":"tool_result","message_id":"m1","step_id":"s1","tool":"lookup","status":"ok","duration_ms":"fast","summary":1}',
      ),
    ).toThrow(ChatStreamParseError);
  });
});

/**
 * 本地编排（/runs/stream）把每个 step_result 映射成聊天事件：
 * 成功的仍是 tool_result；被拒/失败的（如 TOOL_FORBIDDEN）必须是 tool_error，
 * 否则工具卡片会假显示「完成」。
 */
describe('local run step_result mapping', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const localFetch = (lines: string[]) => {
    vi.stubEnv('VITE_LOCAL_LANGGRAPH', 'true');
    return vi.fn(async () =>
      new Response(streamFromChunks(lines.map((line) => `${line}\n`)), {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      }),
    ) as typeof fetch;
  };

  const collect = async (fetchImpl: typeof fetch) => {
    const received: ChatStreamEvent[] = [];
    for await (const event of streamChatFromOrchestrator('查账号', { fetchImpl })) {
      received.push(event);
    }
    return received;
  };

  it('maps a successful step_result to tool_result and a failed one to tool_error', async () => {
    const received = await collect(localFetch([
      '{"type":"run_start","run_id":"run-1","task_id":"task-1"}',
      '{"type":"step_start","run_id":"run-1","step":{"id":"step-ok","tool":"list_m1_tasks","label":"查询订单"}}',
      '{"type":"step_result","run_id":"run-1","step":{"id":"step-ok","tool":"list_m1_tasks","status":"ok"},"output_summary":{"status":"ok","count":2}}',
      '{"type":"step_start","run_id":"run-1","step":{"id":"step-denied","tool":"list_identity_users","label":"查询账号"}}',
      '{"type":"step_result","run_id":"run-1","step":{"id":"step-denied","tool":"list_identity_users","status":"failed","error":{"code":"TOOL_FORBIDDEN","message":"当前账号无权调用 list_identity_users"}},"output_summary":{"status":"failed","code":"TOOL_FORBIDDEN","message":"当前账号无权调用 list_identity_users"}}',
      '{"type":"run_done","run_id":"run-1","state":{"status":"failed"}}',
    ]));

    expect(received.map((event) => event.type)).toEqual([
      'message_start', 'tool_start', 'tool_result', 'tool_start', 'tool_error', 'message_done',
    ]);
    expect(received[2]).toMatchObject({
      type: 'tool_result',
      step_id: 'step-ok',
      tool: 'list_m1_tasks',
      status: 'ok',
      result: { status: 'ok', count: 2 },
    });
    expect(received[4]).toMatchObject({
      type: 'tool_error',
      step_id: 'step-denied',
      tool: 'list_identity_users',
      status: 'failed',
      error: '当前账号无权调用 list_identity_users',
    });
    expect(received[5]).toMatchObject({ type: 'message_done', finish_reason: 'error' });
  });

  it('falls back to the string output_summary and then to 执行失败 for the error reason', async () => {
    const received = await collect(localFetch([
      '{"type":"run_start","run_id":"run-2","task_id":"task-2"}',
      '{"type":"step_result","run_id":"run-2","step":{"id":"step-forbidden","tool":"list_identity_users","status":"failed"},"output_summary":"TOOL_FORBIDDEN：工人账号没有 order.view 权限"}',
      '{"type":"step_result","run_id":"run-2","step":{"id":"step-broken","tool":"list_m1_tasks","status":"failed"},"output_summary":{"status":"failed"}}',
    ]));

    expect(received[1]).toMatchObject({
      type: 'tool_error',
      step_id: 'step-forbidden',
      error: 'TOOL_FORBIDDEN：工人账号没有 order.view 权限',
    });
    expect(received[2]).toMatchObject({ type: 'tool_error', step_id: 'step-broken', error: '执行失败' });
  });
});
