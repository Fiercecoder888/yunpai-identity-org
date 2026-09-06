import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithApp } from '../../tests/testUtils';
import { ConversationSidebar } from './ConversationSidebar';
import { useChatStore } from '../../store/useChatStore';
import { LOCAL_ORDER_REGISTRY_KEY } from '../business-flow/localOrderRegistry';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const conversation = {
  id: 'conv-example-1',
  title: '新对话',
  title_source: 'manual' as const,
  status: 'active' as const,
  created_at: '2026-08-06T00:00:00Z',
  updated_at: '2026-08-06T00:00:00Z',
  last_message_at: '2026-08-06T00:00:00Z',
  version: 1,
};

const streamResponse = () =>
  new Response(
    new ReadableStream({
      start(controller) {
        const events = [
          { type: 'message_start', message_id: 'm1', session_id: 's1', conversation_id: conversation.id, created_at: 'now', conversation_version: 1 },
          { type: 'delta', message_id: 'm1', content: '订单全链路已查询完成。' },
          { type: 'message_done', message_id: 'm1', finish_reason: 'stop' },
        ];
        controller.enqueue(new TextEncoder().encode(`${events.map((event) => JSON.stringify(event)).join('\n')}\n`));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } },
  );

describe('ConversationSidebar 示例任务', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/orchestrator/chat/stream')) return streamResponse();
      if (url.endsWith('/orchestrator/chat/conversations') && method === 'POST') return jsonResponse(conversation, 201);
      if (url.endsWith('/run-config/candidate-run-manifest.json')) {
        return jsonResponse([
          { catalog_id: 'hist-catalog-088', order: { order_id: 'SO-HIST-CAND-20260724-088', product_name: 'HDMI 8' } },
        ]);
      }
      return jsonResponse({ items: [], next_cursor: null });
    }));
    useChatStore.getState().resetChat();
    localStorage.removeItem(LOCAL_ORDER_REGISTRY_KEY);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('展示示例任务列表', () => {
    renderWithApp(
      <MemoryRouter>
        <ConversationSidebar />
      </MemoryRouter>,
    );

    expect(screen.getByRole('region', { name: '示例任务' })).toBeInTheDocument();
    for (const title of ['订单全链路', '物料库存追踪', '成品库汇总', '成本差异', '采购预警', '排程与齐套', 'BOM/SOP 制品', '工程图纸']) {
      expect(screen.getByRole('button', { name: title })).toBeInTheDocument();
    }
  });

  it('点击订单全链路直接运行当前选中订单，不再新建会话发聊天', async () => {
    const user = userEvent.setup();
    renderWithApp(
      <MemoryRouter>
        <ConversationSidebar />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: '订单全链路' }));

    await waitFor(() => {
      expect(useChatStore.getState().selectedConversationId).toBeUndefined();
      expect(useChatStore.getState().messages.length).toBe(0);
    });
  });

  it('点击物料库存追踪打开库存总览面板（直接读取 m0 库存，不再发聊天查询）', async () => {
    const user = userEvent.setup();
    renderWithApp(
      <MemoryRouter>
        <ConversationSidebar />
      </MemoryRouter>,
    );
    localStorage.setItem('yunpai-business-flow-selected-order', 'hist-catalog-088');

    await user.click(screen.getByRole('button', { name: '物料库存追踪' }));

    await waitFor(() => expect(screen.getByText('物料库存总览（m0 已入库）')).toBeTruthy());
    // 不应新建会话/发聊天查询
    expect(useChatStore.getState().selectedConversationId).toBeUndefined();
    expect(useChatStore.getState().messages.length).toBe(0);
  });

  it('点击物料库存追踪不依赖选中订单，直接打开面板', async () => {
    const user = userEvent.setup();
    renderWithApp(
      <MemoryRouter>
        <ConversationSidebar />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: '物料库存追踪' }));

    await waitFor(() => expect(screen.getByText('物料库存总览（m0 已入库）')).toBeTruthy());
    expect(useChatStore.getState().messages.length).toBe(0);
  });

  it('active 会话的选中按钮带 aria-current="page"', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/orchestrator/chat/conversations')) {
        return jsonResponse({
          items: [
            conversation,
            { ...conversation, id: 'conv-other', title: '另一个会话' },
          ],
          next_cursor: null,
        });
      }
      return jsonResponse({ items: [], next_cursor: null });
    }));
    useChatStore.setState({ selectedConversationId: conversation.id });

    renderWithApp(
      <MemoryRouter>
        <ConversationSidebar />
      </MemoryRouter>,
    );

    const activeButton = await screen.findByRole('button', { name: '新对话' });
    expect(activeButton).toHaveAttribute('aria-current', 'page');
    const inactiveButton = screen.getByRole('button', { name: '另一个会话' });
    expect(inactiveButton).not.toHaveAttribute('aria-current');
  });

  it('按订单分组展示多个会话，并保留会话选择行为', async () => {
    localStorage.setItem(LOCAL_ORDER_REGISTRY_KEY, JSON.stringify([
      { orderId: 'SO-001', filename: 'SO-001.xlsx', conversationId: conversation.id, updatedAt: '2026-08-06T00:00:00Z' },
      { orderId: 'SO-001', filename: 'SO-001.xlsx', conversationId: 'conv-other', updatedAt: '2026-08-06T00:00:00Z' },
    ]));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/orchestrator/chat/conversations')) {
        return jsonResponse({ items: [
          { ...conversation, title: '采购与物料 · SO-001.xlsx' },
          { ...conversation, id: 'conv-other', title: '订单排程 · SO-001.xlsx' },
        ], next_cursor: null });
      }
      return jsonResponse({ items: [], next_cursor: null });
    }));

    renderWithApp(<MemoryRouter><ConversationSidebar /></MemoryRouter>);

    expect(await screen.findByRole('button', { name: 'SO-001 2' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '采购与物料 · SO-001.xlsx' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '订单排程 · SO-001.xlsx' })).toBeInTheDocument();
  });

  it('不会把普通标题中的“订单”误判为订单组', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/orchestrator/chat/conversations')) {
        return jsonResponse({ items: [{ ...conversation, title: '检查订单A的交期' }], next_cursor: null });
      }
      return jsonResponse({ items: [], next_cursor: null });
    }));

    renderWithApp(<MemoryRouter><ConversationSidebar /></MemoryRouter>);

    expect(await screen.findByRole('button', { name: '未关联订单 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '检查订单A的交期 1' })).not.toBeInTheDocument();
  });

  it('搜索无匹配会话时显示未找到匹配会话，而不是暂无会话', async () => {
    const user = userEvent.setup();
    renderWithApp(
      <MemoryRouter>
        <ConversationSidebar />
      </MemoryRouter>,
    );

    const search = screen.getByRole('textbox', { name: '搜索会话' });
    await user.type(search, '不存在的会话');

    expect(await screen.findByText('未找到匹配会话')).toBeInTheDocument();
    expect(screen.queryByText('暂无会话')).not.toBeInTheDocument();
  });
});
