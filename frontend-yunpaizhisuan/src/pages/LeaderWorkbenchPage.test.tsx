import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithApp } from '../tests/testUtils';
import { LeaderWorkbenchPage } from './LeaderWorkbenchPage';
import { demoRoleStorageKey } from '../features/roles/roleConfig';
import * as leaderApi from '../services/leaderApi';
import { useAuthStore } from '../auth/useAuthStore';

const useLeaderReadOnlyIdentity = () => {
  vi.stubEnv('VITE_ENABLE_MSW', 'false');
  vi.stubEnv('VITE_API_BASE_URL', '/api');
  useAuthStore.setState({
    status: 'ready',
    me: {
      auth_mode: 'shared_anonymous',
      principal_id: 'leader-read-only',
      principal_type: 'shared_anonymous',
      user: { name: '只读组长' },
      tenant: { id: 'tenant', name: 'Shared' },
      shared_data: true,
      roles: ['leader-read-only'],
      permissions: ['leader:read'],
      session: { id: 'session', csrf_token: 'test-only', idle_expires_at: 'later', absolute_expires_at: 'later' },
    },
    error: undefined,
  });
};

describe('LeaderWorkbenchPage', () => {
  beforeEach(() => {
    window.localStorage.setItem(demoRoleStorageKey, 'team-leader');
  });

  afterEach(() => {
    window.localStorage.removeItem(demoRoleStorageKey);
    window.localStorage.removeItem('yunpai.leader-user-id');
    vi.unstubAllEnvs();
    act(() => {
      useAuthStore.setState({ status: 'idle', config: undefined, me: undefined, error: undefined });
    });
  });

  it('renders the leader workbench heading and today tasks', async () => {
    renderWithApp(<LeaderWorkbenchPage />);

    expect(await screen.findByRole('heading', { level: 2 })).toHaveTextContent('小组长工作台');
    expect(await screen.findByText('一车间 A 班（组长：leader-zhang）')).toBeInTheDocument();
    expect(await screen.findByText('OP-10 押出')).toBeInTheDocument();
    expect(await screen.findByText('OP-20 焊接')).toBeInTheDocument();
    expect(await screen.findByText('生产中')).toBeInTheDocument();
  });

  it('reports work from the today task list', async () => {
    const user = userEvent.setup();
    renderWithApp(<LeaderWorkbenchPage />);

    await screen.findByText('OP-10 押出');
    const reportButtons = await screen.findAllByRole('button', { name: /报\s*工/ }, { timeout: 8000 });
    await user.click(reportButtons[0]!);

    expect(await screen.findByText('报工', { selector: '.ant-modal-title' })).toBeInTheDocument();
    const modal = screen.getByRole('dialog');
    await user.click(within(modal!).getAllByRole('combobox')[0]!);
    await user.click(await screen.findByText('王师傅（worker-wang） @ 押出机 01'));
    await user.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('uses a new idempotency key for each separately opened legal report', async () => {
    const user = userEvent.setup();
    const reportSpy = vi.spyOn(leaderApi, 'reportLeaderWork');
    const { queryClient } = renderWithApp(<LeaderWorkbenchPage />);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await screen.findByText('OP-10 押出');
    const submitQuantityReport = async () => {
      const reportButtons = await screen.findAllByRole('button', { name: /报\s*工/ }, { timeout: 8000 });
      await user.click(reportButtons[0]!);
      const modal = await screen.findByRole('dialog');
      const selects = within(modal).getAllByRole('combobox');
      await user.click(selects[0]!);
      await user.click(await screen.findByText('王师傅（worker-wang） @ 押出机 01'));
      await user.click(selects[1]!);
      await user.click(await screen.findByText('报数'));
      const quantity = within(modal).getAllByRole('spinbutton')[0]!;
      await user.type(quantity, '10');
      await user.type(within(modal).getByRole('textbox', { name: '报数单位' }), 'pcs');
      await user.click(within(modal).getByRole('button', { name: 'OK' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    };

    await submitQuantityReport();
    await submitQuantityReport();

    expect(reportSpy).toHaveBeenCalledTimes(2);
    const firstPayload = reportSpy.mock.calls[0]![0];
    const secondPayload = reportSpy.mock.calls[1]![0];
    expect(firstPayload).toMatchObject({
      event_type: 'quantity_report',
      worker_id: 'worker-wang',
      reported_quantity: 10,
      reported_unit: 'pcs',
    });
    expect(firstPayload.idempotency_key).toMatch(/^lr-[a-z0-9]+-[0-9a-f-]{36}$/);
    expect(secondPayload.idempotency_key).toMatch(/^lr-[a-z0-9]+-[0-9a-f-]{36}$/);
    expect(secondPayload.idempotency_key).not.toBe(firstPayload.idempotency_key);
    for (const queryKey of [['m5-pmc-progress'], ['m5-execution-summary'], ['m5-schedule-detail'], ['schedule-board']]) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey });
    }
  });

  it('does not submit a leader quantity report without an explicit unit', async () => {
    const user = userEvent.setup();
    const reportSpy = vi.spyOn(leaderApi, 'reportLeaderWork');
    renderWithApp(<LeaderWorkbenchPage />);

    await screen.findByText('OP-10 押出');
    const reportButtons = await screen.findAllByRole('button', { name: /报\s*工/ });
    await user.click(reportButtons[0]!);
    const modal = await screen.findByRole('dialog');
    const selects = within(modal).getAllByRole('combobox');
    await user.click(selects[0]!);
    await user.click(await screen.findByText('王师傅（worker-wang） @ 押出机 01'));
    await user.click(selects[1]!);
    await user.click(await screen.findByText('报数'));
    await user.type(within(modal).getByRole('spinbutton', { name: '报数数量' }), '10');
    await user.click(within(modal).getByRole('button', { name: 'OK' }));

    expect(await within(modal).findByText('请输入报数单位')).toBeInTheDocument();
    expect(reportSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps the leader report open when the backend rejects a mismatched unit', async () => {
    const { server } = await import('../mocks/server');
    const { http, HttpResponse } = await import('msw');
    let rejectedUnit: string | undefined;
    server.use(http.post('/api/m5/leader/report', async ({ request }) => {
      const body = await request.json() as { reported_unit?: string };
      rejectedUnit = body.reported_unit;
      return HttpResponse.json({
        success: false,
        data: null,
        errors: [{ message: 'reported_unit must match the immutable plan order unit' }],
        trace_id: 'unit-mismatch',
      }, { status: 422 });
    }));
    const user = userEvent.setup();
    renderWithApp(<LeaderWorkbenchPage />);

    await screen.findByText('OP-10 押出');
    const reportButtons = await screen.findAllByRole('button', { name: /报\s*工/ });
    await user.click(reportButtons[0]!);
    const modal = await screen.findByRole('dialog');
    const selects = within(modal).getAllByRole('combobox');
    await user.click(selects[0]!);
    await user.click(await screen.findByText('王师傅（worker-wang） @ 押出机 01'));
    await user.click(selects[1]!);
    await user.click(await screen.findByText('报数'));
    await user.type(within(modal).getByRole('spinbutton', { name: '报数数量' }), '10');
    await user.type(within(modal).getByRole('textbox', { name: '报数单位' }), 'm');
    await user.click(within(modal).getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(rejectedUnit).toBe('m'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows workload ledger, comparison and order trace tabs', async () => {
    const user = userEvent.setup();
    renderWithApp(<LeaderWorkbenchPage />);

    await screen.findByText('OP-10 押出');

    await user.click(screen.getByRole('tab', { name: '工作量台账' }));
    expect((await screen.findAllByText('480')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('已完工')).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('tab', { name: '工时对比' }));
    expect(await screen.findByText('王师傅（worker-wang）')).toBeInTheDocument();
    expect(await screen.findByText('+55 分钟')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '订单追溯' }));
    const orderInput = screen.getByPlaceholderText('订单号（如 SO-LEADER-001）');
    await user.clear(orderInput);
    await user.type(orderInput, 'SO-LEADER-001');
    await user.click(screen.getByRole('button', { name: '查台账' }));
    const tracePanel = await screen.findByTestId('order-trace-result');
    expect(await within(tracePanel!).findByText('OP-10 押出')).toBeInTheDocument();
    expect(await within(tracePanel!).findByText('已完工')).toBeInTheDocument();
  });

  it('keeps a multi-megabyte order trace bounded after a real button click', async () => {
    const { server } = await import('../mocks/server');
    const { http, HttpResponse } = await import('msw');
    server.use(
      http.get('/api/orchestrator/business-orders/:orderId/trace', ({ params }) =>
        HttpResponse.json({
          order_id: String(params.orderId),
          inventory_movements: Array.from({ length: 10_000 }, (_, index) => ({
            id: `large-movement-${index}`,
            sequence: index,
            payload: 'x'.repeat(600),
          })),
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithApp(<LeaderWorkbenchPage />);

    await screen.findByText('OP-10 押出');
    await user.click(screen.getByRole('tab', { name: '订单追溯' }));
    await user.click(screen.getByRole('button', { name: '订单全链路追溯（工时/物料/良率）' }));

    const limit = await screen.findByText('仅显示前 100 条，共 10000 条');
    expect(limit).toBeInTheDocument();
    const traceCard = limit.closest('.structured-json-section-card');
    expect(traceCard).not.toBeNull();
    expect(traceCard!.querySelectorAll('.ant-table-tbody .ant-table-row').length).toBeLessThanOrEqual(20);
    expect(screen.getByText('large-movement-0')).toBeInTheDocument();
    expect(screen.queryByText('large-movement-100')).not.toBeInTheDocument();
  });

  it('allows creating a team when the leader has none', async () => {
    const { server } = await import('../mocks/server');
    const { http, HttpResponse } = await import('msw');
    server.use(
      http.get('/api/m5/leader/teams', () =>
        HttpResponse.json({ success: true, data: [], errors: [], trace_id: 'msw-empty' }),
      ),
    );
    const user = userEvent.setup();
    const createSpy = vi.spyOn(leaderApi, 'createLeaderTeam');
    renderWithApp(<LeaderWorkbenchPage />);

    expect(await screen.findByText('班组初始化（首次使用）')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('如 TEAM-A1'), 'TEAM-B1');
    await user.type(screen.getByPlaceholderText('如一车间 A 班'), '一车间 B 班');
    await user.click(screen.getByRole('button', { name: '创建班组' }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    expect(createSpy.mock.calls[0]![0]).toMatchObject({
      team_code: 'TEAM-B1',
      team_name: '一车间 B 班',
      leader_user_id: 'leader-zhang',
    });
  });

  it('keeps report and member writes closed for a leader-read-only role', async () => {
    useLeaderReadOnlyIdentity();
    const user = userEvent.setup();
    const reportSpy = vi.spyOn(leaderApi, 'reportLeaderWork');
    const memberSpy = vi.spyOn(leaderApi, 'addLeaderTeamMember');
    renderWithApp(<LeaderWorkbenchPage />);

    await screen.findByText('OP-10 押出');
    const reportButtons = await screen.findAllByRole('button', { name: /报\s*工/ });
    const addMember = screen.getByRole('button', { name: '添加工人' });
    await waitFor(() => {
      expect(reportButtons[0]).toBeDisabled();
      expect(addMember).toBeDisabled();
    });
    await user.click(reportButtons[0]!);
    await user.click(addMember);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(reportSpy).not.toHaveBeenCalled();
    expect(memberSpy).not.toHaveBeenCalled();
  });

  it('keeps team creation closed for a leader-read-only role', async () => {
    useLeaderReadOnlyIdentity();
    const { server } = await import('../mocks/server');
    const { http, HttpResponse } = await import('msw');
    server.use(
      http.get('/api/m5/leader/teams', () =>
        HttpResponse.json({ success: true, data: [], errors: [], trace_id: 'msw-empty-read-only' }),
      ),
    );
    const user = userEvent.setup();
    const createSpy = vi.spyOn(leaderApi, 'createLeaderTeam');
    renderWithApp(<LeaderWorkbenchPage />);

    expect(await screen.findByText('班组初始化（首次使用）')).toBeInTheDocument();
    const createButton = screen.getByRole('button', { name: '创建班组' });
    await waitFor(() => expect(createButton).toBeDisabled());
    await user.type(screen.getByPlaceholderText('如 TEAM-A1'), 'TEAM-READ-ONLY{enter}');
    await user.click(createButton);

    expect(createSpy).not.toHaveBeenCalled();
  });
});
