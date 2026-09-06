import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../mocks/server';
import { renderWithApp } from '../tests/testUtils';
import { useAuthStore } from '../auth/useAuthStore';
import { M5FlowDashboardPage } from './M5FlowDashboardPage';

const flowItem = {
  plan_version: 'plan-v2',
  parent_plan_version: 'plan-v1',
  tracking_task_id: 'task_real_123',
  overall_status: 'attention',
  progress_percent: 80,
  input: {
    scenario_id: 'scenario-real',
    scenario_purpose: 'pressure_only',
    received_at: '2026-07-27T08:00:00Z',
    order_count: 1,
    orders: [{
      order_id: 'SO-REAL-001',
      product_id: 'SKU-001',
      quantity: 12,
      unit: 'pcs',
      due_time: '2026-07-30T08:00:00Z',
      priority: 'high',
      status: 'confirmed',
      is_expedited: true,
    }],
    routing_step_count: 4,
    resource_count: 3,
    material_availability_count: 8,
    bom_item_count: 6,
  },
  output: {
    plan_version: 'plan-v2',
    solver_status: 'optimal',
    validation_passed: true,
    lifecycle_status: 'released',
    scheduled_operation_count: 4,
    scheduled_order_count: 1,
    scheduled_resource_count: 3,
    operations: [{
      order_id: 'SO-REAL-001',
      product_id: 'SKU-001',
      operation_id: 'OP-10',
      operation_name: '组装',
      resource_id: 'EQ-01',
      start_time: '2026-07-27T08:00:00Z',
      end_time: '2026-07-27T10:00:00Z',
      duration_minutes: 120,
      status: 'scheduled',
      source: 'cp_sat',
    }],
    operations_truncated: false,
    resource_load_minutes: { 'EQ-01': 120 },
    dispatch_count: 1,
    failed_dispatch_count: 0,
    dispatch_item_count: 4,
    dispatch_acknowledged_count: 4,
    dispatch_failed_count: 0,
    execution_event_count: 2,
    approved_at: '2026-07-27T08:05:00Z',
    released_at: '2026-07-27T08:06:00Z',
  },
  stages: [
    { key: 'input', label: '输入持久化', status: 'succeeded', completed: 1, total: 1, message: 'input persisted' },
    { key: 'scheduling', label: '排程生成', status: 'succeeded', completed: 4, total: 4, message: '4 operations persisted' },
    { key: 'validation', label: '硬约束校验', status: 'succeeded', completed: 1, total: 1, message: 'passed' },
    { key: 'approval', label: '计划审批', status: 'succeeded', completed: 1, total: 1, message: 'released' },
    { key: 'dispatch', label: '派发确认', status: 'succeeded', completed: 4, total: 4, message: '4/4 acknowledged' },
    { key: 'execution', label: '执行回传', status: 'running', completed: 2, total: 4, message: '2 events' },
  ],
  jobs: [{
    id: 'job-real-1',
    job_type: 'schedule',
    status: 'succeeded',
    result_plan_version: 'plan-v2',
    persist_requested: true,
    matches_plan_version: true,
    attempts: 1,
    max_attempts: 3,
    error: null,
    created_at: '2026-07-27T08:00:00Z',
    started_at: '2026-07-27T08:00:01Z',
    finished_at: '2026-07-27T08:00:03Z',
  }],
  tracking: {
    mode: 'shadow',
    tracking_task_id: 'task_real_123',
    event_count: 4,
    by_status: { sent: 3, dead_letter: 1 },
    sent_count: 3,
    pending_count: 0,
    retry_count: 0,
    processing_count: 0,
    dead_letter_count: 1,
    latest_error: 'IDEMPOTENCY_CONFLICT',
    last_updated_at: '2026-07-27T08:06:00Z',
  },
  updated_at: '2026-07-27T08:06:00Z',
} as const;

describe('M5FlowDashboardPage', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
    act(() => {
      useAuthStore.setState({ status: 'idle', config: undefined, me: undefined, error: undefined });
    });
    vi.unstubAllEnvs();
  });

  it('prefills filters from a business-page link and queries the exact plan', async () => {
    let requestedUrl = '';
    window.history.replaceState(
      {},
      '',
      '/modules/m5-flow?tracking_task_id=task_real_123&plan_version=plan-v2',
    );
    server.use(
      http.get('/api/m5/ops/flow-dashboard', ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json({ success: true, data: [flowItem], errors: [] });
      }),
    );

    renderWithApp(<M5FlowDashboardPage />);

    await screen.findAllByText('SO-REAL-001');
    expect(screen.getByLabelText('Tracking TaskID')).toHaveValue('task_real_123');
    expect(screen.getByLabelText('排程版本')).toHaveValue('plan-v2');
    expect(requestedUrl).toContain('tracking_task_id=task_real_123');
    expect(requestedUrl).toContain('plan_version=plan-v2');
  });

  it('queries by Tracking TaskID and renders persisted business evidence', async () => {
    const user = userEvent.setup();
    let requestedUrl = '';
    server.use(
      http.get('/api/m5/ops/flow-dashboard', ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json([flowItem]);
      }),
    );

    renderWithApp(<M5FlowDashboardPage />);
    await screen.findAllByText('SO-REAL-001');
    await user.clear(screen.getByLabelText('Tracking TaskID'));
    await user.type(screen.getByLabelText('Tracking TaskID'), 'task_real_123');
    await user.click(screen.getByRole('button', { name: /查询业务数据/ }));

    await waitFor(() => expect(requestedUrl).toContain('tracking_task_id=task_real_123'));
    expect(screen.getAllByText('plan-v2').length).toBeGreaterThan(0);
    expect(screen.getByText('version_of')).toBeInTheDocument();
    expect(screen.getAllByText('SO-REAL-001').length).toBeGreaterThan(0);
    expect(screen.getByText(/最近错误：IDEMPOTENCY_CONFLICT/)).toBeInTheDocument();
    expect(screen.getByText('job-real-1')).toBeInTheDocument();
    expect(screen.getAllByText('EQ-01').length).toBeGreaterThan(0);
    expect(screen.getAllByText('120 分钟').length).toBeGreaterThan(0);
    expect(screen.getByText('当前为测试排程，未进入生产发布')).toBeInTheDocument();
    expect(screen.getAllByText('4/4').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('img', { name: /进度阶段：输入持久化 1\/1/ })).toBeInTheDocument();
  });

  it('distinguishes a successful empty response from connected business data', async () => {
    server.use(http.get('/api/m5/ops/flow-dashboard', () => HttpResponse.json([])));

    renderWithApp(<M5FlowDashboardPage />);

    expect(await screen.findByText('M5 暂无已持久化的排程版本')).toBeInTheDocument();
    expect(screen.getByLabelText('返回计划版本 0')).toBeInTheDocument();
  });

  it('shows an actionable authentication failure for a 401 response', async () => {
    server.use(
      http.get('/api/m5/ops/flow-dashboard', () =>
        HttpResponse.json({ detail: 'Unauthorized' }, { status: 401 })),
    );

    renderWithApp(<M5FlowDashboardPage />);

    expect(await screen.findByText('身份认证失败')).toBeInTheDocument();
    expect(screen.getByText(/身份会话未建立或已过期/)).toBeInTheDocument();
  });

  it('shows approve action for draft schedules and submits feedback', async () => {
    const user = userEvent.setup();
    let posted: unknown;
    server.use(
      http.get('/api/m5/ops/flow-dashboard', () =>
        HttpResponse.json({
          success: true,
          data: [{ ...flowItem, output: { ...flowItem.output, lifecycle_status: 'draft' } }],
          errors: [],
        }),
      ),
      http.post('/api/m5/schedules/:planVersion/feedback', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ success: true, data: { lifecycle_status: 'approved' }, errors: [] }, { status: 200 });
      }),
    );

    renderWithApp(<M5FlowDashboardPage />);

    const approve = await screen.findByRole('button', { name: '审批通过' });
    await waitFor(() => expect(approve).toBeEnabled());
    await user.click(approve);

    await waitFor(() => {
      const body = posted as Record<string, unknown> | undefined;
      expect(body?.action).toBe('approve');
      expect(body?.reason).toBe('审批通过');
    });
  });

  it('keeps lifecycle actions closed while permissions are loading', async () => {
    let resolvePermission: (() => void) | undefined;
    const permissionReady = new Promise<void>((resolve) => {
      resolvePermission = resolve;
    });
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    useAuthStore.setState({ status: 'idle', me: undefined, error: undefined });
    server.use(
      http.get('/api/auth/me', async () => {
        await permissionReady;
        return HttpResponse.json({
          id: 'shared-developer',
          name: '共享开发者',
          permissions: ['schedule:read', 'schedule:write'],
        });
      }),
      http.get('/api/m5/ops/flow-dashboard', () =>
        HttpResponse.json({
          success: true,
          data: [{ ...flowItem, output: { ...flowItem.output, lifecycle_status: 'draft' } }],
          errors: [],
        }),
      ),
    );

    renderWithApp(<M5FlowDashboardPage />);

    expect(screen.queryByRole('button', { name: '审批通过' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /拒\s*绝/ })).not.toBeInTheDocument();

    resolvePermission?.();
    await waitFor(() => expect(screen.getByRole('button', { name: '审批通过' })).toBeEnabled());
    expect(screen.getByRole('button', { name: /拒\s*绝/ })).toBeEnabled();
  });

  it('disables approve and reject when the current role lacks schedule:write', async () => {
    let feedbackCalls = 0;
    window.localStorage.setItem('mockRoleId', 'team-leader');
    server.use(
      http.get('/api/m5/ops/flow-dashboard', () =>
        HttpResponse.json({
          success: true,
          data: [{ ...flowItem, output: { ...flowItem.output, lifecycle_status: 'draft' } }],
          errors: [],
        }),
      ),
      http.post('/api/m5/schedules/:planVersion/feedback', () => {
        feedbackCalls += 1;
        return HttpResponse.json({ success: true, data: {}, errors: [] });
      }),
    );

    renderWithApp(<M5FlowDashboardPage />);

    expect(await screen.findByRole('button', { name: '审批通过' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /拒\s*绝/ })).toBeDisabled();
    expect(screen.getAllByTestId('action-gate-blocked')).toHaveLength(2);
    expect(feedbackCalls).toBe(0);
  });

  it('requires schedule:write before releasing an approved schedule', async () => {
    let feedbackCalls = 0;
    window.localStorage.setItem('mockRoleId', 'team-leader');
    server.use(
      http.get('/api/m5/ops/flow-dashboard', () =>
        HttpResponse.json({
          success: true,
          data: [{ ...flowItem, output: { ...flowItem.output, lifecycle_status: 'approved' } }],
          errors: [],
        }),
      ),
      http.post('/api/m5/schedules/:planVersion/feedback', () => {
        feedbackCalls += 1;
        return HttpResponse.json({ success: true, data: {}, errors: [] });
      }),
    );

    renderWithApp(<M5FlowDashboardPage />);

    expect(await screen.findByRole('button', { name: '生产发布' })).toBeDisabled();
    expect(screen.getAllByTestId('action-gate-blocked')).toHaveLength(1);
    expect(feedbackCalls).toBe(0);
  });

  it('submits release feedback when the current role holds schedule:write', async () => {
    const user = userEvent.setup();
    let posted: unknown;
    server.use(
      http.get('/api/m5/ops/flow-dashboard', () =>
        HttpResponse.json({
          success: true,
          data: [{ ...flowItem, output: { ...flowItem.output, lifecycle_status: 'approved' } }],
          errors: [],
        }),
      ),
      http.post('/api/m5/schedules/:planVersion/feedback', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ success: true, data: { lifecycle_status: 'released' }, errors: [] });
      }),
    );

    renderWithApp(<M5FlowDashboardPage />);

    const release = await screen.findByRole('button', { name: '生产发布' });
    await waitFor(() => expect(release).toBeEnabled());
    await user.click(release);

    await waitFor(() => expect(posted).toMatchObject({ action: 'release', reason: '生产发布' }));
  });

  it('submits only one lifecycle request when the action is clicked repeatedly', async () => {
    const user = userEvent.setup();
    let feedbackCalls = 0;
    let resolveFeedback: (() => void) | undefined;
    const feedbackReady = new Promise<void>((resolve) => {
      resolveFeedback = resolve;
    });
    server.use(
      http.get('/api/m5/ops/flow-dashboard', () =>
        HttpResponse.json({
          success: true,
          data: [{ ...flowItem, output: { ...flowItem.output, lifecycle_status: 'draft' } }],
          errors: [],
        }),
      ),
      http.post('/api/m5/schedules/:planVersion/feedback', async () => {
        feedbackCalls += 1;
        await feedbackReady;
        return HttpResponse.json({ success: true, data: { lifecycle_status: 'approved' }, errors: [] });
      }),
    );

    renderWithApp(<M5FlowDashboardPage />);

    const approve = await screen.findByRole('button', { name: '审批通过' });
    await waitFor(() => expect(approve).toBeEnabled());
    await Promise.all([user.click(approve), user.click(approve)]);

    await waitFor(() => expect(feedbackCalls).toBe(1));
    expect(approve).toBeDisabled();
    resolveFeedback?.();
    await waitFor(() => expect(approve).toBeEnabled());
  });

  it('keeps each plan disabled while concurrent lifecycle feedback is pending', async () => {
    const user = userEvent.setup();
    let feedbackCalls = 0;
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const firstReady = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const secondReady = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });
    const first = {
      ...flowItem,
      output: { ...flowItem.output, lifecycle_status: 'draft' },
    };
    const second = {
      ...flowItem,
      plan_version: 'plan-v3',
      parent_plan_version: 'plan-v2',
      tracking_task_id: 'task_real_456',
      input: {
        ...flowItem.input,
        scenario_id: 'scenario-real-2',
        orders: [{ ...flowItem.input.orders[0], order_id: 'SO-REAL-002' }],
      },
      output: { ...flowItem.output, plan_version: 'plan-v3', lifecycle_status: 'draft' },
      jobs: [],
    };
    server.use(
      http.get('/api/m5/ops/flow-dashboard', () =>
        HttpResponse.json({ success: true, data: [first, second], errors: [] }),
      ),
      http.post('/api/m5/schedules/:planVersion/feedback', async ({ params }) => {
        feedbackCalls += 1;
        await (params.planVersion === 'plan-v2' ? firstReady : secondReady);
        return HttpResponse.json({ success: true, data: { lifecycle_status: 'approved' }, errors: [] });
      }),
    );

    renderWithApp(<M5FlowDashboardPage />);

    const firstPlan = await screen.findByRole('button', { name: /plan-v2/ });
    const secondPlan = screen.getByRole('button', { name: /plan-v3/ });
    const firstApprove = await screen.findByRole('button', { name: '审批通过' });
    await user.click(firstApprove);
    await waitFor(() => expect(feedbackCalls).toBe(1));
    expect(firstApprove).toBeDisabled();

    await user.click(secondPlan);
    await screen.findByRole('heading', { level: 3, name: 'plan-v3' });
    const secondApprove = screen.getByRole('button', { name: '审批通过' });
    expect(secondApprove).toBeEnabled();
    await user.click(secondApprove);
    await waitFor(() => expect(feedbackCalls).toBe(2));
    expect(secondApprove).toBeDisabled();

    await user.click(firstPlan);
    await screen.findByRole('heading', { level: 3, name: 'plan-v2' });
    expect(screen.getByRole('button', { name: /审批通过/ })).toBeDisabled();

    resolveFirst();
    await waitFor(() => expect(screen.getByRole('button', { name: /审批通过/ })).toBeEnabled());
    await user.click(secondPlan);
    await screen.findByRole('heading', { level: 3, name: 'plan-v3' });
    expect(screen.getByRole('button', { name: /审批通过/ })).toBeDisabled();

    resolveSecond();
    await waitFor(() => expect(screen.getByRole('button', { name: /审批通过/ })).toBeEnabled());
  });
});
