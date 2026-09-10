import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithApp } from '../tests/testUtils';
import { EnterpriseAssistantPage } from './EnterpriseAssistantPage';
import { useAuthStore } from '../auth/useAuthStore';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { useBusinessRunStore } from '../features/business-flow/useBusinessRunStore';
import { CHAT_LAST_CONVERSATION_KEY, useChatStore } from '../store/useChatStore';

const fileDataTransfer = (files: File[]) => ({ types: ['Files'], files });

/**
 * 厂长 / 主数据管理员：种子角色里唯一拥有 `order.ingest`（上传、导入订单）的岗位，
 * 因此能看到 M1–M5 订单全链路面板。
 */
const ORDER_INGEST_PERMISSIONS = ['order.ingest', 'order.view', 'report.view'];

/** 品保：只有订单查看/复核/报表权限，没有 `order.ingest` → 不该看到 M1–M5 面板。 */
const QUALITY_ASSURANCE_PERMISSIONS = ['order.view', 'order.review', 'report.view'];

/** 写入当前登录身份（真实鉴权模式下 `/api/auth/me` 的结构）。 */
const signIn = (permissions: string[]) => {
  useAuthStore.setState({
    status: 'ready',
    me: { tenant_id: 'default', user_id: 'u-test', display_name: '测试用户', roles: [], permissions },
  });
};

const orderFlowPanelRegion = () => screen.queryByRole('region', { name: '订单业务流程' });

const dispatchDrag = (
  type: string,
  dataTransfer: unknown,
  options?: { relatedTarget?: EventTarget | null },
) => {
  act(() => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    if (options?.relatedTarget !== undefined) {
      Object.defineProperty(event, 'relatedTarget', { value: options.relatedTarget });
    }
    window.dispatchEvent(event);
  });
};

describe('EnterpriseAssistantPage', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'ready', config: undefined, me: undefined, error: undefined });
    useBusinessRunStore.getState().reset();
    useBusinessRunStore.getState().setSelectedCatalogId(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const renderPage = (initialEntries = ['/']) =>
    renderWithApp(
      <MemoryRouter initialEntries={initialEntries}>
        <EnterpriseAssistantPage />
      </MemoryRouter>,
    );

  it('renders the assistant as the user entry without a legacy dashboard link', () => {
    signIn(ORDER_INGEST_PERMISSIONS);
    renderWithApp(
      <MemoryRouter>
        <EnterpriseAssistantPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('云湃企业助手')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '订单业务流程' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('询问订单、风险或排程状态')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '调试工作台' })).not.toBeInTheDocument();
  });

  it('restores the last selected server conversation after refreshing the root route', async () => {
    const conversationId = '90909090-9090-4090-8090-909090909090';
    localStorage.setItem(CHAT_LAST_CONVERSATION_KEY, conversationId);
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(`/chat/conversations/${conversationId}/messages`)) {
        return Promise.resolve(new Response(JSON.stringify({
          items: [{
            id: 'restored-message', role: 'assistant', content: '刷新后仍然可见', status: 'completed',
            structured_data: null, created_at: '2026-08-26T00:00:00Z', run: null,
          }],
          next_cursor: null,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response(JSON.stringify({ items: [], next_cursor: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithApp(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<EnterpriseAssistantPage />} />
          <Route path="/c/:conversationId" element={<EnterpriseAssistantPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(useChatStore.getState()).toMatchObject({
      selectedConversationId: conversationId,
      messages: [{ id: 'restored-message', content: '刷新后仍然可见' }],
    }));
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith(`/chat/conversations/${conversationId}/messages`))).toBe(true);
  });

  it('shows OIDC login only when the server enables it and keeps shared-data context visible', () => {
    useAuthStore.setState({
      config: { auth_mode: 'shared_anonymous', oidc_enabled: true, shared_data: true, csrf_required: true,
        capabilities: { anonymous_session: true, oidc_login: true, session_management: true, user_isolation: false } },
      me: { auth_mode: 'shared_anonymous', principal_id: 'shared-principal', principal_type: 'shared_anonymous', user: null, shared_data: true,
        tenant: { id: 'tenant', name: 'Shared' }, roles: [], permissions: [],
        session: { id: 'session', csrf_token: 'memory-only', idle_expires_at: 'later', absolute_expires_at: 'later' } },
    });
    renderWithApp(<MemoryRouter initialEntries={['/c/abc']}><EnterpriseAssistantPage /></MemoryRouter>);

    expect(screen.getByText('共享数据')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '登录' })).toHaveAttribute('href', '/api/auth/login?return_to=%2Fc%2Fabc');
  });

  it('shows the drop overlay while a file drag enters the window and hides it again on leave', () => {
    renderPage();

    dispatchDrag('dragenter', fileDataTransfer([]));
    expect(screen.getByTestId('chat-drop-overlay')).toBeInTheDocument();

    dispatchDrag('dragleave', fileDataTransfer([]), { relatedTarget: document.body });
    expect(screen.queryByTestId('chat-drop-overlay')).not.toBeInTheDocument();
  });

  it('does not show the overlay for non-file drags', () => {
    renderPage();

    dispatchDrag('dragenter', { types: ['text/plain'] });
    expect(screen.queryByTestId('chat-drop-overlay')).not.toBeInTheDocument();
  });

  it('closes the drop overlay with Escape', () => {
    renderPage();

    dispatchDrag('dragenter', fileDataTransfer([]));
    expect(screen.getByTestId('chat-drop-overlay')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(screen.queryByTestId('chat-drop-overlay')).not.toBeInTheDocument();
  });

  it('opens the order upload modal prefilled after pasting an order file', async () => {
    renderPage();
    const orderFile = new File(['order'], 'paste-order.csv', { type: 'text/csv' });
    const clipboard = {
      items: [{ kind: 'file', getAsFile: () => orderFile }],
      files: [orderFile],
    } as unknown as DataTransfer;

    act(() => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: clipboard });
      window.dispatchEvent(event);
    });

    expect(await screen.findByRole('dialog', { name: /上传订单文件/ })).toBeInTheDocument();
    expect(await screen.findByText('paste-order.csv')).toBeInTheDocument();
  });

  it('opens the M0 import modal prefilled after dropping an M0 file', async () => {
    renderPage();
    const m0File = new File(['plan'], 'plan.dwg');

    dispatchDrag('drop', fileDataTransfer([m0File]));

    expect(await screen.findByRole('dialog', { name: /M0 数据导入/ })).toBeInTheDocument();
    expect(await screen.findByTestId('m0-upload-file-list')).toHaveTextContent('plan.dwg');
  });

  it('opens the order upload modal prefilled after dropping an order file', async () => {
    renderPage();
    const orderFile = new File(['order'], 'drop-order.csv', { type: 'text/csv' });

    dispatchDrag('drop', fileDataTransfer([orderFile]));

    expect(await screen.findByRole('dialog', { name: /上传订单文件/ })).toBeInTheDocument();
    expect(await screen.findByText('drop-order.csv')).toBeInTheDocument();
  });

  it('keeps the M0 import modal when an order-like file is dropped while it is open', async () => {
    renderPage();

    act(() => {
      screen.getByRole('button', { name: '上传或导入' }).click();
    });
    act(() => {
      screen.getByText('M0 数据导入（基础数据库建设）').click();
    });
    expect(await screen.findByRole('dialog', { name: /M0 数据导入/ })).toBeInTheDocument();

    const orderLikeFile = new File(['order'], 'W-E651备货订单.xlsx');
    dispatchDrag('drop', fileDataTransfer([orderLikeFile]));

    expect(await screen.findByTestId('m0-upload-file-list')).toHaveTextContent('W-E651备货订单.xlsx');
    expect(screen.getByRole('dialog', { name: /M0 数据导入/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /上传订单文件/ })).not.toBeInTheDocument();
  });

  it('keeps the order upload modal when an m0-only file is dropped while it is open', async () => {
    renderPage();

    act(() => {
      screen.getByRole('button', { name: '上传或导入' }).click();
    });
    act(() => {
      screen.getByText('上传订单文件（订单到排程）').click();
    });
    expect(await screen.findByRole('dialog', { name: /上传订单文件/ })).toBeInTheDocument();

    const m0File = new File(['plan'], 'plan.dwg');
    dispatchDrag('drop', fileDataTransfer([m0File]));

    expect(await screen.findByText('plan.dwg')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /上传订单文件/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /M0 数据导入/ })).not.toBeInTheDocument();
  });

  it('loads the selected order trace before showing PMC progress from a cold start', async () => {
    signIn(ORDER_INGEST_PERMISSIONS);
    const user = userEvent.setup();
    let tracedOrderId: string | undefined;
    server.use(http.get('/api/orchestrator/business-orders/:orderId/trace', ({ params }) => {
      tracedOrderId = String(params.orderId);
      return HttpResponse.json({
        tenant_id: 'mock-tenant',
        order_id: tracedOrderId,
        order: { order_id: tracedOrderId, lifecycle_status: 'completed' },
        materials: [],
        order_materials: [],
        inventory_balances: [],
        inventory_movements: [],
        procurement_plans: [],
        procurement_plan_lines: [],
        purchase_orders: [],
        schedule_versions: [{ source_schedule_id: 'current' }],
        business_flow_runs: [],
      });
    }));
    renderPage();

    await screen.findByText('SO-HIST-008 · HDMI 线缆');
    await user.click(screen.getByRole('button', { name: '上传或导入' }));
    await user.click(await screen.findByText('查看 PMC 实际进度'));

    expect(await screen.findByText('SO-PMC-001')).toBeInTheDocument();
    expect(tracedOrderId).toBe('SO-HIST-008');
    expect(screen.queryByText('暂无可查看的 PMC 计划进度')).not.toBeInTheDocument();
  });

  it('reloads PMC progress for the newly selected order instead of reusing the previous plan', async () => {
    signIn(ORDER_INGEST_PERMISSIONS);
    const user = userEvent.setup();
    const tracedOrderIds: string[] = [];
    server.use(http.get('/api/orchestrator/business-orders/:orderId/trace', ({ params }) => {
      const orderId = String(params.orderId);
      tracedOrderIds.push(orderId);
      return HttpResponse.json({
        tenant_id: 'mock-tenant',
        order_id: orderId,
        order: { order_id: orderId, lifecycle_status: 'completed' },
        materials: [],
        order_materials: [],
        inventory_balances: [],
        inventory_movements: [],
        procurement_plans: [],
        procurement_plan_lines: [],
        purchase_orders: [],
        schedule_versions: [{ source_schedule_id: orderId === 'SO-HIST-008' ? 'plan-a' : 'plan-b' }],
        business_flow_runs: [],
      });
    }));
    renderPage();

    await screen.findByText('SO-HIST-008 · HDMI 线缆');
    await user.click(screen.getByRole('button', { name: 'eye 查看' }));
    await waitFor(() => expect(tracedOrderIds).toContain('SO-HIST-008'));

    await user.click(screen.getByRole('combobox', { name: '选择业务订单' }));
    await user.click(await screen.findByText('SO-HIST-080 · USB 线缆'));
    await user.click(screen.getByRole('button', { name: '上传或导入' }));
    await user.click(await screen.findByText('查看 PMC 实际进度'));

    expect(await screen.findByText('plan-b')).toBeInTheDocument();
    expect(tracedOrderIds).toEqual(['SO-HIST-008', 'SO-HIST-080']);
    expect(screen.queryByText('plan-a')).not.toBeInTheDocument();
  });

  it('refreshes the trace when reopening PMC for the same order so a newer plan is selected', async () => {
    signIn(ORDER_INGEST_PERMISSIONS);
    const user = userEvent.setup();
    let traceCalls = 0;
    server.use(http.get('/api/orchestrator/business-orders/:orderId/trace', ({ params }) => {
      traceCalls += 1;
      const orderId = String(params.orderId);
      return HttpResponse.json({
        tenant_id: 'mock-tenant',
        order_id: orderId,
        order: { order_id: orderId, lifecycle_status: 'completed' },
        materials: [],
        order_materials: [],
        inventory_balances: [],
        inventory_movements: [],
        procurement_plans: [],
        procurement_plan_lines: [],
        purchase_orders: [],
        schedule_versions: [{ source_schedule_id: traceCalls === 1 ? 'plan-v1' : 'plan-v2' }],
        business_flow_runs: [],
      });
    }));
    localStorage.setItem('yunpai-business-flow-selected-order', 'hist-catalog-008');
    useBusinessRunStore.getState().setSelectedCatalogId('hist-catalog-008');
    renderPage();

    await screen.findByText('SO-HIST-008 · HDMI 线缆');
    await user.click(screen.getByRole('button', { name: 'eye 查看' }));
    expect(await screen.findByText('plan-v1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '上传或导入' }));
    await user.click(await screen.findByText('查看 PMC 实际进度'));

    expect(await screen.findByText('plan-v2')).toBeInTheDocument();
    expect(traceCalls).toBe(2);
    expect(screen.queryByText('plan-v1')).not.toBeInTheDocument();
  });

  it('does not let a slow trace response from the previous order replace the selected order', async () => {
    signIn(ORDER_INGEST_PERMISSIONS);
    const user = userEvent.setup();
    let releaseFirstTrace: (() => void) | undefined;
    let firstTraceStarted = false;
    let firstTraceReturned = false;
    const firstTraceGate = new Promise<void>((resolve) => {
      releaseFirstTrace = resolve;
    });
    server.use(http.get('/api/orchestrator/business-orders/:orderId/trace', async ({ params }) => {
      const orderId = String(params.orderId);
      if (orderId === 'SO-HIST-008') {
        firstTraceStarted = true;
        await firstTraceGate;
        firstTraceReturned = true;
      }
      return HttpResponse.json({
        tenant_id: 'mock-tenant',
        order_id: orderId,
        order: { order_id: orderId, lifecycle_status: 'completed' },
        materials: [],
        order_materials: [],
        inventory_balances: [],
        inventory_movements: [],
        procurement_plans: [],
        procurement_plan_lines: [],
        purchase_orders: [],
        schedule_versions: [{ source_schedule_id: orderId === 'SO-HIST-008' ? 'slow-plan-a' : 'plan-b' }],
        business_flow_runs: [],
      });
    }));
    localStorage.setItem('yunpai-business-flow-selected-order', 'hist-catalog-008');
    useBusinessRunStore.getState().setSelectedCatalogId('hist-catalog-008');
    renderPage();

    await screen.findByRole('combobox', { name: '选择业务订单' });
    await screen.findByText('SO-HIST-008 · HDMI 线缆');
    await user.click(screen.getByRole('button', { name: 'eye 查看' }));
    await waitFor(() => expect(firstTraceStarted).toBe(true));

    await user.click(screen.getByRole('combobox', { name: '选择业务订单' }));
    await user.click(await screen.findByText('SO-HIST-080 · USB 线缆'));
    await waitFor(() => expect(useBusinessRunStore.getState().selectedCatalogId).toBe('hist-catalog-080'));
    await user.click(screen.getByRole('button', { name: '上传或导入' }));
    await user.click(await screen.findByText('查看 PMC 实际进度'));
    expect(await screen.findByText('plan-b')).toBeInTheDocument();

    releaseFirstTrace?.();
    await waitFor(() => expect(firstTraceReturned).toBe(true));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });

    expect(useBusinessRunStore.getState().trace?.order_id).toBe('SO-HIST-080');
    expect(screen.getByText('plan-b')).toBeInTheDocument();
    expect(screen.queryByText('slow-plan-a')).not.toBeInTheDocument();
  });

  it('keeps the PMC empty state repeatable when no order is available', async () => {
    signIn(ORDER_INGEST_PERMISSIONS);
    const user = userEvent.setup();
    server.use(
      http.get('/historical-order-catalog.json', () => HttpResponse.json([])),
      http.get('/run-config/candidate-run-manifest.json', () => HttpResponse.json([])),
    );
    renderPage();

    await user.click(screen.getByRole('button', { name: '上传或导入' }));
    await user.click(await screen.findByText('查看 PMC 实际进度'));
    expect(await screen.findByText('PMC 数据未完善')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '收起订单流程大屏' }));
    expect(screen.queryByText('PMC 数据未完善')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '上传或导入' }));
    await user.click(await screen.findByText('查看 PMC 实际进度'));
    expect(await screen.findByText('PMC 数据未完善')).toBeInTheDocument();
  });

  it('shows the M1-M5 order flow panel for an account that can ingest orders', () => {
    signIn(ORDER_INGEST_PERMISSIONS);
    renderPage();

    expect(orderFlowPanelRegion()).toBeInTheDocument();
    expect(document.querySelector('main.assistant-shell')).not.toHaveClass('assistant-shell-no-flow');
  });

  it('hides the M1-M5 order flow panel for quality assurance but keeps the chat usable', () => {
    signIn(QUALITY_ASSURANCE_PERMISSIONS);
    renderPage();

    expect(orderFlowPanelRegion()).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '订单管理与 M1-M5 流程' })).not.toBeInTheDocument();
    // 品保只是看不到这个框，对话功能与厂长一致。
    expect(screen.getByPlaceholderText('询问订单、风险或排程状态')).toBeInTheDocument();
    // 不占位、不留空列：外壳切到两行布局。
    expect(document.querySelector('main.assistant-shell')).toHaveClass('assistant-shell-no-flow');
  });

  it('hides the M1-M5 order flow panel without crashing when nobody is signed in', () => {
    useAuthStore.setState({ status: 'ready', config: undefined, me: undefined, error: undefined });
    renderPage();

    expect(orderFlowPanelRegion()).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('询问订单、风险或排程状态')).toBeInTheDocument();
    expect(document.querySelector('main.assistant-shell')).toHaveClass('assistant-shell-no-flow');
  });

  it('keeps the panel hidden when the signed-in account has no permissions at all', () => {
    signIn([]);
    renderPage();

    expect(orderFlowPanelRegion()).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('询问订单、风险或排程状态')).toBeInTheDocument();
  });
});
