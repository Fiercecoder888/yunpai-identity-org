import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithApp } from '../../tests/testUtils';
import * as chatApi from '../../services/chatApi';
import type { ChatStreamItem } from '../../services/chatApi';
import { useChatStore } from '../../store/useChatStore';
import { ChatPanel, SUGGESTED_PROMPTS } from './ChatPanel';

describe('ChatPanel', () => {
  it('renders sender and streamed bubbles', async () => {
    const user = userEvent.setup();
    async function* stream() {
      yield { id: 'chunk-1', content: '排程', done: false };
      yield { id: 'chunk-2', content: '存在高风险。', done: true };
    }

    renderWithApp(<ChatPanel streamFactory={stream} />);

    expect(screen.getByText('今天要处理什么？')).toBeInTheDocument();
    expect(screen.getByTestId('chat-composer').querySelector('.chat-sender-opaque')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('询问订单、风险或排程状态'), '查看排程风险');
    await user.keyboard('{Enter}');

    expect(await screen.findByText('查看排程风险')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('排程存在高风险。')).toBeInTheDocument());
  });

  it('shows suggestion chips in the empty state and sends the chosen prompt', async () => {
    async function* stream() {
      yield { id: 'chunk-a', content: '已为你完成风险体检。', done: true };
    }

    renderWithApp(<ChatPanel streamFactory={stream} />);

    const chip = screen.getByRole('button', { name: SUGGESTED_PROMPTS[0] });
    expect(screen.getByRole('button', { name: SUGGESTED_PROMPTS[1] })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SUGGESTED_PROMPTS[2] })).toBeInTheDocument();

    fireEvent.click(chip);

    expect(await screen.findByText('已为你完成风险体检。')).toBeInTheDocument();
  });

  it('offers "you may also ask" templates after a completed reply', async () => {
    async function* stream() {
      yield { id: 'chunk-b', content: '本周排程没有冲突。', done: true };
    }

    renderWithApp(<ChatPanel streamFactory={stream} />);

    fireEvent.click(screen.getByRole('button', { name: SUGGESTED_PROMPTS[1] }));

    expect(await screen.findByText('本周排程没有冲突。')).toBeInTheDocument();
    expect(screen.getByTestId('chat-followups')).toBeInTheDocument();
    expect(screen.getByText('你可能还想问：')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '哪些订单存在延期风险？' })).toBeInTheDocument();
  });

  it('shows an empty-reply fallback card when streaming returns no content', async () => {
    async function* stream() {
      yield { id: 'chunk-c', content: '', done: true };
    }

    renderWithApp(<ChatPanel streamFactory={stream} />);

    fireEvent.click(screen.getByRole('button', { name: SUGGESTED_PROMPTS[2] }));

    expect(await screen.findByText('未获取到有效回答，请重试或换一种问法')).toBeInTheDocument();
  });

  it('excludes empty-content turns from the follow-ups conversation payload (round-2 regression)', async () => {
    // 第二轮：assistant 只执行工具、无文本输出（content 为空）。此轮次不得进入
    // follow-ups conversation，否则后端 FollowUpTurn.content(min_length=1) 校验 422。
    const user = userEvent.setup();
    const spy = vi.spyOn(chatApi, 'requestFollowUps').mockResolvedValue({ questions: ['追问一'], source: 'llm' });
    try {
      let round = 0;
      async function* stream() {
        round += 1;
        if (round === 1) {
          yield { id: 'r1', content: '第一轮回答。', done: true };
        } else {
          yield { id: 'r2', content: '', done: true };
        }
      }

      renderWithApp(<ChatPanel streamFactory={stream} />);

      fireEvent.click(screen.getByRole('button', { name: '排查本周排程冲突' }));
      expect(await screen.findByText('第一轮回答。')).toBeInTheDocument();
      await waitFor(() => expect(spy).toHaveBeenCalled());

      await user.type(screen.getByPlaceholderText('询问订单、风险或排程状态'), '再查采购预警');
      await user.keyboard('{Enter}');

      // 第二轮 assistant 完成（空 content）后必须再发一次 follow-ups 请求
      await waitFor(() => {
        expect(spy.mock.calls.some(([call]) => call.message === '再查采购预警')).toBe(true);
      });
      // 核心回归断言：任何一次请求的 conversation 都不得含空 content 轮次
      // （旧实现会把工具型空回复轮次原样传给后端，触发 FollowUpTurn.content 校验 422）
      for (const [call] of spy.mock.calls) {
        expect(call.conversation.every((turn) => turn.content.trim().length > 0)).toBe(true);
      }
      const lastRound2Call = [...spy.mock.calls].reverse().find(([call]) => call.message === '再查采购预警')![0];
      expect(lastRound2Call.conversation).toEqual([
        { role: 'user', content: '排查本周排程冲突' },
        { role: 'assistant', content: '第一轮回答。' },
        { role: 'user', content: '再查采购预警' },
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  it('marks the upload/import menu button with aria-expanded while open', async () => {
    const user = userEvent.setup();
    renderWithApp(<ChatPanel />);

    const menuButton = screen.getByRole('button', { name: '上传或导入' });
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');

    await user.click(menuButton);
    expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('上传订单文件（订单到排程）')).toBeInTheDocument();
  });

  it('exposes PMC progress from the existing tool menu', async () => {
    const user = userEvent.setup();
    const onToolAction = vi.fn();
    renderWithApp(<ChatPanel onToolAction={onToolAction} />);

    await user.click(screen.getByRole('button', { name: '上传或导入' }));
    await user.click(await screen.findByText('查看 PMC 实际进度'));

    expect(onToolAction).toHaveBeenCalledWith('pmc-progress');
  });

  it('renders M2 artifact download/preview buttons from tool result', async () => {
    async function* stream(): AsyncGenerator<ChatStreamItem> {
      yield {
        type: 'message_start',
        message_id: 'm1',
        session_id: 's',
        conversation_id: 'c',
        created_at: '2026-08-13T00:00:00Z',
      };
      yield { type: 'tool_start', message_id: 'm1', step_id: 'st1', tool: 'list_m2_runs', label: 'list_m2_runs' };
      yield {
        type: 'tool_result',
        message_id: 'm1',
        step_id: 'st1',
        tool: 'list_m2_runs',
        status: 'ok',
        duration_ms: 12,
        summary: '工具调用成功',
        result: {
          success: true,
          data: {
            items: [
              {
                run_id: 'run-1',
                product_name: 'XH041',
                artifact_paths: {
                  bom_response_json: '/app/outputs/runs/run-1/bom_generation_response.json',
                },
              },
            ],
            total: 1,
          },
        },
      };
      yield { type: 'delta', message_id: 'm1', content: '已列出 BOM/SOP run 及制品。' };
      yield { type: 'message_done', message_id: 'm1', finish_reason: 'stop' };
    }

    renderWithApp(<ChatPanel streamFactory={stream} />);
    fireEvent.click(screen.getByRole('button', { name: '查看最近订单全链路' }));

    expect(await screen.findByTestId('chat-m2-artifacts')).toBeInTheDocument();
    expect(screen.getByText(/XH041 · bom_response_json/)).toBeInTheDocument();
  });

  it('renders a preview button for streamed BOM data_ref and opens the table modal', async () => {
    async function* stream(): AsyncGenerator<ChatStreamItem> {
      yield {
        type: 'message_start',
        message_id: 'm1',
        session_id: 's',
        conversation_id: 'c',
        created_at: '2026-08-13T00:00:00Z',
      };
      yield { type: 'tool_start', message_id: 'm1', step_id: 'st1', tool: 'generate_m2_bom_controlled', label: '生成受控 BOM' };
      yield {
        type: 'tool_result',
        message_id: 'm1',
        step_id: 'st1',
        tool: 'generate_m2_bom_controlled',
        status: 'ok',
        duration_ms: 12,
        summary: '工具调用成功',
        data_ref: {
          kind: 'bom',
          title: 'BOM-FG-01',
          summary: '共 2 行 BOM 明细',
          rows: [
            { component_item: 'CBL-01', component_name: '线材', qty_per: 1 },
            { component_item: 'PKG-01', component_name: 'PE袋', qty_per: 1 },
          ],
        },
      };
      yield { type: 'delta', message_id: 'm1', content: '已生成受控 BOM 草稿。' };
      yield { type: 'message_done', message_id: 'm1', finish_reason: 'stop' };
    }

    renderWithApp(<ChatPanel streamFactory={stream} />);
    fireEvent.click(screen.getByRole('button', { name: '查看最近订单全链路' }));

    const previewButton = await screen.findByRole('button', { name: /预览 BOM/ });
    expect(previewButton).toBeInTheDocument();
    expect(await screen.findByText('已生成受控 BOM 草稿。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /预览 BOM/ })).toBeInTheDocument();

    fireEvent.click(previewButton);
    expect(await screen.findByText('BOM-FG-01')).toBeInTheDocument();
    expect(screen.getByText('CBL-01')).toBeInTheDocument();
    expect(screen.getByText('PE袋')).toBeInTheDocument();
    expect(screen.getByText('共 2 行 BOM 明细')).toBeInTheDocument();
  });

  it('opens the drawing file modal from a streamed drawing data_ref', async () => {
    async function* stream(): AsyncGenerator<ChatStreamItem> {
      yield {
        type: 'message_start',
        message_id: 'm1',
        session_id: 's',
        conversation_id: 'c',
        created_at: '2026-08-13T00:00:00Z',
      };
      yield { type: 'tool_start', message_id: 'm1', step_id: 'st1', tool: 'get_m1_document', label: '获取工程图文档' };
      yield {
        type: 'tool_result',
        message_id: 'm1',
        step_id: 'st1',
        tool: 'get_m1_document',
        status: 'ok',
        duration_ms: 12,
        summary: '工具调用成功',
        data_ref: { kind: 'drawing', title: '外壳图纸.png', summary: '工程图纸原文件预览', file_url: '/api/m1/files/task-dwg-1' },
      };
      yield { type: 'delta', message_id: 'm1', content: '已识别工程图。' };
      yield { type: 'message_done', message_id: 'm1', finish_reason: 'stop' };
    }

    renderWithApp(<ChatPanel streamFactory={stream} />);
    fireEvent.click(screen.getByRole('button', { name: '查看最近订单全链路' }));

    const previewButton = await screen.findByRole('button', { name: /预览 图纸/ });
    fireEvent.click(previewButton);

    expect(await screen.findByText('外壳图纸.png')).toBeInTheDocument();
    const iframe = document.querySelector('.ant-modal iframe') as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('src')).toBe('/api/m1/files/task-dwg-1');
  });

  it('opens the M7 warehouse once when the inbound prepare tool completes live', async () => {
    const onToolAction = vi.fn();
    async function* stream(): AsyncGenerator<ChatStreamItem> {
      yield {
        type: 'message_start',
        message_id: 'm7-message',
        session_id: 's',
        conversation_id: 'c',
        created_at: '2026-08-24T00:00:00Z',
      };
      yield {
        type: 'tool_start',
        message_id: 'm7-message',
        step_id: 'm7-prepare-step',
        tool: 'prepare_m7_inbound_workflow',
        label: '准备 M7 入库流程',
      };
      yield {
        type: 'tool_result',
        message_id: 'm7-message',
        step_id: 'm7-prepare-step',
        tool: 'prepare_m7_inbound_workflow',
        status: 'ok',
        duration_ms: 8,
        summary: '工具调用成功',
        result: {
          success: true,
          data: { workflow: 'm7_inbound', status: 'awaiting_documents', requires_human_review: true },
          errors: [],
          trace_id: 'task_chat_m7_inbound',
        },
      };
      yield { type: 'delta', message_id: 'm7-message', content: '请上传送货文件。' };
      yield { type: 'message_done', message_id: 'm7-message', finish_reason: 'stop' };
    }

    renderWithApp(<ChatPanel streamFactory={stream} onToolAction={onToolAction} />);
    fireEvent.click(screen.getByRole('button', { name: SUGGESTED_PROMPTS[3] }));

    await waitFor(() => expect(onToolAction).toHaveBeenCalledTimes(1));
    expect(onToolAction).toHaveBeenLastCalledWith('m7-warehouse', {
      m7Tab: 'delivery',
      m7Panel: 'file-recognition',
      trackingTaskId: 'task_chat_m7_inbound',
    });
    fireEvent.click(await screen.findByRole('button', { name: '上传送货单文件' }));
    expect(onToolAction).toHaveBeenCalledTimes(2);
    expect(onToolAction).toHaveBeenLastCalledWith('m7-warehouse', {
      m7Tab: 'delivery',
      m7Panel: 'file-recognition',
      trackingTaskId: 'task_chat_m7_inbound',
    });
  });

  it.each([
    ['prepare_m7_quality_inspection_workflow', 'qc', 'M7 品保待检流程'],
    ['prepare_m7_material_issue_workflow', 'issue', 'M7 领料/超领流程'],
    ['prepare_m7_inventory_query_workflow', 'inventory', 'M7 库存流程'],
  ] as const)('opens the matching M7 tab when %s completes live', async (tool, m7Tab, label) => {
    const onToolAction = vi.fn();
    async function* stream(): AsyncGenerator<ChatStreamItem> {
      yield {
        type: 'message_start',
        message_id: `message-${m7Tab}`,
        session_id: 's',
        conversation_id: 'c',
        created_at: '2026-08-26T00:00:00Z',
      };
      yield {
        type: 'tool_start',
        message_id: `message-${m7Tab}`,
        step_id: `step-${m7Tab}`,
        tool,
        label: `准备 ${label}`,
      };
      yield {
        type: 'tool_result',
        message_id: `message-${m7Tab}`,
        step_id: `step-${m7Tab}`,
        tool,
        status: 'ok',
        duration_ms: 8,
        summary: '工具调用成功',
        result: { success: true, data: { ui_action: { tab: m7Tab } }, errors: [] },
      };
      yield { type: 'delta', message_id: `message-${m7Tab}`, content: `已准备${label}。` };
      yield { type: 'message_done', message_id: `message-${m7Tab}`, finish_reason: 'stop' };
    }

    renderWithApp(<ChatPanel streamFactory={stream} onToolAction={onToolAction} />);
    fireEvent.click(screen.getByRole('button', { name: SUGGESTED_PROMPTS[3] }));

    await waitFor(() => expect(onToolAction).toHaveBeenCalledTimes(1));
    expect(onToolAction).toHaveBeenLastCalledWith('m7-warehouse', { m7Tab });
    fireEvent.click(await screen.findByRole('button', { name: `打开 ${label}` }));
    expect(onToolAction).toHaveBeenLastCalledWith('m7-warehouse', { m7Tab });
  });

  it('does not auto-open M7 when a completed prepare step comes from history', async () => {
    const onToolAction = vi.fn();
    useChatStore.setState({
      messages: [{
        id: 'historical-assistant',
        role: 'assistant',
        content: '已准备入库流程。',
        status: 'completed',
        tools: [{
          id: 'historical-m7-step',
          tool: 'prepare_m7_inbound_workflow',
          label: '准备 M7 入库流程',
          status: 'ok',
          result: { success: true, data: { workflow: 'm7_inbound' } },
        }],
      }],
    });

    renderWithApp(<ChatPanel onToolAction={onToolAction} />);

    expect(await screen.findByRole('button', { name: '上传送货单文件' })).toBeInTheDocument();
    expect(onToolAction).not.toHaveBeenCalled();
  });

  it('applies a live M7 supplement result without opening another modal', async () => {
    const onToolAction = vi.fn();
    const onM7DraftSupplement = vi.fn();
    async function* stream(): AsyncGenerator<ChatStreamItem> {
      yield {
        type: 'message_start',
        message_id: 'm7-supplement-message',
        session_id: 's',
        conversation_id: 'c',
        created_at: '2026-08-26T00:00:00Z',
      };
      yield {
        type: 'tool_start',
        message_id: 'm7-supplement-message',
        step_id: 'm7-supplement-step',
        tool: 'parse_m7_delivery_note_supplement',
        label: '解析送货单补录信息',
      };
      yield {
        type: 'tool_result',
        message_id: 'm7-supplement-message',
        step_id: 'm7-supplement-step',
        tool: 'parse_m7_delivery_note_supplement',
        status: 'ok',
        duration_ms: 6,
        summary: '补录信息已解析',
        result: { success: true, data: { updates: { supplier_id: 'SUP-001' } } },
      };
      yield { type: 'delta', message_id: 'm7-supplement-message', content: '已补上供应商内部编号。' };
      yield { type: 'message_done', message_id: 'm7-supplement-message', finish_reason: 'stop' };
    }

    renderWithApp(
      <ChatPanel
        streamFactory={stream}
        onToolAction={onToolAction}
        onM7DraftSupplement={onM7DraftSupplement}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: SUGGESTED_PROMPTS[3] }));

    await waitFor(() => expect(onM7DraftSupplement).toHaveBeenCalledTimes(1));
    expect(onM7DraftSupplement).toHaveBeenCalledWith({
      success: true,
      data: { updates: { supplier_id: 'SUP-001' } },
    });
    expect(onToolAction).not.toHaveBeenCalled();
  });

  it('keeps manual delivery entry as an explicit choice for a recognized draft', async () => {
    const onToolAction = vi.fn();
    renderWithApp(<ChatPanel
      onToolAction={onToolAction}
      m7DeliveryDraft={{
        m0_batch_id: 'batch-1',
        tracking_task_id: 'task-1',
        suggested: {},
        items: [{}],
        missing_fields: ['supplier_id'],
        warnings: [],
        recognized_document_types: [],
        reference_fields: {},
        source_documents: [],
        requires_human_review: true,
      }}
    />);

    expect(screen.getByText('送货单草稿还缺 1 项，可直接在下方补充')).toBeInTheDocument();
    expect(onToolAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '手动补录' }));
    expect(onToolAction).toHaveBeenCalledWith('m7-warehouse', { m7Tab: 'delivery' });
  });
});
