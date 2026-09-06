import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthMe } from '../auth/authApi';
import { useAuthStore } from '../auth/useAuthStore';
import { server } from '../mocks/server';
import { currentRoleQueryKey } from '../services/permissionApi';
import { renderWithApp } from '../tests/testUtils';
import { useWorkbenchStore } from '../store/useWorkbenchStore';
import type { ScheduleBoard } from '../types/api';
import scheduleBoardFixture from '../mocks/fixtures/scheduleBoard.json';
import { ScheduleGanttPage } from './ScheduleGanttPage';

const authenticatedMe = (overrides: Partial<AuthMe> = {}): AuthMe => ({
  auth_mode: 'shared_anonymous',
  principal_id: 'pmc-operator',
  principal_type: 'shared_anonymous',
  user: { name: 'PMC 操作员' },
  tenant: { id: 'tenant-a', name: '测试租户' },
  shared_data: true,
  roles: ['pmc-operator'],
  permissions: ['schedule:read', 'schedule:write'],
  session: { id: 'session-a', csrf_token: 'test-only', idle_expires_at: 'later', absolute_expires_at: 'later' },
  ...overrides,
});

const m5Envelope = (data: unknown) => ({ success: true, data, errors: [], trace_id: 'msw-m5-trace' });

const dispatchPointer = (target: Element, type: string, clientX: number) => {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 0 }));
  });
};

describe('ScheduleGanttPage', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    act(() => {
      useAuthStore.setState({ status: 'idle', config: undefined, me: undefined, error: undefined });
    });
  });

  it('renders loading state before data resolves', () => {
    const { container } = renderWithApp(<ScheduleGanttPage />);

    expect(container.querySelector('.ant-spin')).toBeInTheDocument();
  });

  it('renders empty schedule and conflict states', async () => {
    server.use(http.get('/api/m5/schedules', () => HttpResponse.json([])));

    renderWithApp(<ScheduleGanttPage />);

    expect((await screen.findAllByText('暂无数据')).length).toBeGreaterThan(0);
    expect(await screen.findByText('暂无冲突')).toBeInTheDocument();
  });

  it('renders normal data and opens task details', async () => {
    const user = userEvent.setup();

    renderWithApp(<ScheduleGanttPage />);

    await screen.findByTestId('gantt-placeholder');
    await user.click(screen.getByRole('button', { name: /订单 A 粗加工/ }));

    expect(await screen.findByText('任务详情')).toBeInTheDocument();
    expect(await screen.findByText('计划开始偏移')).toBeInTheDocument();
    expect(await screen.findByText(/订单 A 粗加工 -> 订单 B 表面处理 \/ finish_to_start \/ 滞后 0 天/)).toBeInTheDocument();
    expect(screen.getByTestId('gantt-links-svg')).toBeInTheDocument();
    expect(screen.getByTestId('gantt-link-DEP-1')).toBeInTheDocument();
  });

  it('polls the standalone schedule board every ten seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let boardGets = 0;
    server.use(http.get('/api/m5/schedules/current', () => {
      boardGets += 1;
      return HttpResponse.json(m5Envelope(scheduleBoardFixture));
    }));

    try {
      renderWithApp(<ScheduleGanttPage />);
      await waitFor(() => expect(boardGets).toBeGreaterThanOrEqual(1));
      const initialBoardGets = boardGets;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      await waitFor(() => expect(boardGets).toBeGreaterThan(initialBoardGets));
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the head schedule lifecycle status on the Gantt card', async () => {
    server.use(
      http.get('/api/m5/schedules', () =>
        HttpResponse.json({
          success: true,
          data: [
            {
              plan_version: 'cp-sat-lifecycle-001',
              scenario_purpose: 'production',
              solver_status: 'optimal',
              validation_passed: true,
              lifecycle_status: 'released',
              approved_at: '2026-08-09T01:00:00Z',
              released_at: '2026-08-09T02:00:00Z',
              created_at: '2026-08-09T00:00:00Z',
            },
          ],
        }),
      ),
    );

    renderWithApp(<ScheduleGanttPage />);

    await screen.findByTestId('gantt-placeholder');
    expect(await screen.findByTestId('schedule-lifecycle-strip')).toBeInTheDocument();
    expect(screen.getByText('排程状态：已发布')).toBeInTheDocument();
    expect(screen.getByText('校验通过')).toBeInTheDocument();
    expect(screen.getByText('生产排程')).toBeInTheDocument();
    expect(screen.getByText('计划版本 cp-sat-lifecycle-001')).toBeInTheDocument();
    expect(screen.getByTestId('schedule-lifecycle-time').textContent).toContain('发布于');
  });

  it('marks a failed-validation draft plan clearly on the Gantt card', async () => {
    server.use(
      http.get('/api/m5/schedules', () =>
        HttpResponse.json({
          success: true,
          data: [
            {
              plan_version: 'cp-sat-invalid-001',
              scenario_purpose: 'pressure_only',
              solver_status: 'optimal',
              validation_passed: false,
              lifecycle_status: 'draft',
              created_at: '2026-08-09T00:00:00Z',
            },
          ],
        }),
      ),
    );

    renderWithApp(<ScheduleGanttPage />);

    await screen.findByTestId('gantt-placeholder');
    expect(screen.getByText('排程状态：草稿')).toBeInTheDocument();
    expect(screen.getByText('校验未通过')).toBeInTheDocument();
    expect(screen.getByText('压力测试')).toBeInTheDocument();
  });

  it('filters resources and switches scale', async () => {
    renderWithApp(<ScheduleGanttPage />);

    await screen.findByTestId('gantt-placeholder');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '资源筛选' }));
    await userEvent.click(await screen.findByTitle('产线 2'));

    expect(useWorkbenchStore.getState().scheduleResourceFilter).toBe('line-2');
    expect(screen.queryByRole('button', { name: /订单 A 粗加工/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /订单 B 表面处理/ })).toBeInTheDocument();

    await userEvent.click(screen.getByText('周'));
    expect(useWorkbenchStore.getState().scheduleScale).toBe('week');
    expect((await screen.findAllByText(/W26/)).length).toBeGreaterThan(0);
  });

  it('adjusts a task and writes an operation log', async () => {
    const user = userEvent.setup();
    let auditBody: unknown;
    server.use(
      http.post('/api/audit/logs', async ({ request }) => {
        auditBody = await request.json();
        return HttpResponse.json(auditBody as Record<string, unknown>, { status: 201 });
      }),
    );

    renderWithApp(<ScheduleGanttPage />);

    await screen.findByTestId('gantt-placeholder');
    await user.click(screen.getByRole('button', { name: /订单 A 粗加工/ }));
    await user.click(await screen.findByRole('button', { name: '提交调整' }));

    await waitFor(() => expect(auditBody).toMatchObject({ action: 'M5_SCHEDULE_ADJUSTED', targetId: 'SCH-1' }));
    expect(await screen.findByText('排程调整已提交')).toBeInTheDocument();
  });

  it('shows a log warning when adjustment succeeds but operation log fails', async () => {
    const user = userEvent.setup();
    server.use(http.post('/api/audit/logs', () => HttpResponse.json({ message: 'fail' }, { status: 500 })));

    renderWithApp(<ScheduleGanttPage />);

    await screen.findByTestId('gantt-placeholder');
    await user.click(screen.getByRole('button', { name: /订单 A 粗加工/ }));
    await user.click(await screen.findByRole('button', { name: '提交调整' }));

    expect(await screen.findByText('排程调整已提交')).toBeInTheDocument();
    expect((await screen.findAllByText('日志同步失败')).length).toBeGreaterThan(0);
  });

  it('shows adjustment failure when mutation fails and keeps the task visible', async () => {
    const user = userEvent.setup();
    server.use(http.patch('/api/m5/schedules/:planVersion/operations/:orderId/:operationId', () => HttpResponse.json({ message: 'fail' }, { status: 500 })));

    renderWithApp(<ScheduleGanttPage />);

    await screen.findByTestId('gantt-placeholder');
    await user.click(screen.getByRole('button', { name: /订单 A 粗加工/ }));
    await user.click(await screen.findByRole('button', { name: '提交调整' }));

    expect(await screen.findByText('排程调整失败')).toBeInTheDocument();
    expect(within(screen.getByTestId('gantt-placeholder')).getByRole('button', { name: /订单 A 粗加工/ })).toBeInTheDocument();
  });

  it('renders error state for failed board endpoint', async () => {
    server.use(http.get('/api/m5/schedules', () => HttpResponse.json({ message: 'Mock server error' }, { status: 500 })));

    renderWithApp(<ScheduleGanttPage />);

    expect((await screen.findAllByText('数据加载失败')).length).toBeGreaterThan(0);
  });

  it('drags a task to a new day with optimistic update, PATCH and audit log', async () => {
    let patchBody: unknown;
    let resolvePatch: ((response: Response) => void) | undefined;
    server.use(
      http.patch('/api/m5/schedules/:planVersion/operations/:orderId/:operationId', async ({ request }) => {
        patchBody = await request.json();
        return new Promise<Response>((resolve) => {
          resolvePatch = resolve;
        });
      }),
    );
    let auditBody: unknown;
    server.use(
      http.post('/api/audit/logs', async ({ request }) => {
        auditBody = await request.json();
        return HttpResponse.json(auditBody as Record<string, unknown>, { status: 201 });
      }),
    );

    const { queryClient } = renderWithApp(<ScheduleGanttPage />);

    await screen.findByTestId('gantt-placeholder');
    const taskButton = screen.getByRole('button', { name: /订单 A 粗加工/ });

    dispatchPointer(taskButton, 'pointerdown', 100);
    dispatchPointer(taskButton, 'pointermove', 424);
    dispatchPointer(taskButton, 'pointerup', 424);

    await waitFor(() => {
      const board = queryClient.getQueryData<ScheduleBoard>(['schedule-board']);
      expect(board?.tasks.find((item) => item.id === 'SCH-1')).toMatchObject({
        startDay: 3,
        actualStartDay: 0,
        actualDurationDays: 3,
      });
    });
    expect(patchBody).toMatchObject({
      start_time: '2026-06-29T08:00:00+08:00',
      end_time: '2026-07-02T18:00:00+08:00',
      lock_after_adjust: false,
    });

    resolvePatch?.(HttpResponse.json(m5Envelope({})));

    await waitFor(() => expect(auditBody).toMatchObject({ action: 'M5_SCHEDULE_ADJUSTED', targetId: 'SCH-1' }));
    expect(await screen.findByText('排程调整已提交')).toBeInTheDocument();
  });

  it('optimistically updates only the selected order when operation ids are reused', async () => {
    let patchIdentity: { orderId?: string; operationId?: string } = {};
    let resolvePatch: ((response: Response) => void) | undefined;
    server.use(
      http.get('/api/m5/schedules/current', () => HttpResponse.json(m5Envelope({
        plan_version: 'current',
        operations: [
          {
            order_id: 'SO-A',
            product_id: 'SKU-A',
            operation_id: 'OP-10',
            operation_name: '订单 A 裁线',
            resource_id: 'line-a',
            start_day: 0,
            duration_days: 1,
            status: 'solved',
          },
          {
            order_id: 'SO-B',
            product_id: 'SKU-B',
            operation_id: 'OP-10',
            operation_name: '订单 B 裁线',
            resource_id: 'line-b',
            start_day: 3,
            duration_days: 1,
            status: 'solved',
          },
        ],
      }))),
      http.patch('/api/m5/schedules/:planVersion/operations/:orderId/:operationId', ({ params }) => {
        patchIdentity = { orderId: String(params.orderId), operationId: String(params.operationId) };
        return new Promise<Response>((resolve) => {
          resolvePatch = resolve;
        });
      }),
    );

    const { queryClient } = renderWithApp(<ScheduleGanttPage />);
    await screen.findByTestId('gantt-placeholder');
    const taskButton = screen.getByRole('button', { name: /订单 A 裁线/ });

    dispatchPointer(taskButton, 'pointerdown', 100);
    dispatchPointer(taskButton, 'pointermove', 300);
    dispatchPointer(taskButton, 'pointerup', 300);

    await waitFor(() => {
      const board = queryClient.getQueryData<ScheduleBoard>(['schedule-board']);
      expect(board?.tasks.find((task) => task.id === 'SO-A::OP-10')).toMatchObject({ startDay: 1, status: 'adjusted' });
      expect(board?.tasks.find((task) => task.id === 'SO-B::OP-10')).toMatchObject({ startDay: 3, status: 'solved' });
    });
    expect(patchIdentity).toEqual({ orderId: 'SO-A', operationId: 'OP-10' });

    resolvePatch?.(HttpResponse.json(m5Envelope({})));
    expect(await screen.findByText('排程调整已提交')).toBeInTheDocument();
  });

  it('keeps precise hour-level times when dragging a task by a day', async () => {
    let patchBody: unknown;
    const customBoard: ScheduleBoard = {
      resources: [{ id: 'line-1', name: '产线 1' }],
      tasks: [
        { id: 'SCH-1', title: '订单 A 粗加工', resourceId: 'line-1', startDay: 0, durationDays: 3, status: 'solved', planVersion: 'M5-PLAN-HOUR', startAt: '2026-06-29T00:00:00.000Z', endAt: '2026-06-29T01:45:00.000Z' },
        { id: 'SCH-2', title: '订单 B 表面处理', resourceId: 'line-2', startDay: 2, durationDays: 3, status: 'conflict', planVersion: 'M5-PLAN-HOUR' },
        { id: 'SCH-3', title: '订单 C 装配', resourceId: 'line-3', startDay: 4, durationDays: 2, status: 'draft', planVersion: 'M5-PLAN-HOUR' },
      ],
      conflicts: [],
      timelineStart: '2026-06-29T00:00:00.000Z',
    };
    server.use(
      http.get('/api/m5/schedules/current', () => HttpResponse.json(m5Envelope(customBoard))),
      http.patch('/api/m5/schedules/:planVersion/operations/:orderId/:operationId', async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json(m5Envelope({ validation_passed: false }));
      }),
      http.post('/api/audit/logs', async ({ request }) => {
        const body = await request.json();
        return HttpResponse.json(body as Record<string, unknown>, { status: 201 });
      }),
    );

    renderWithApp(<ScheduleGanttPage />);

    await screen.findByTestId('gantt-placeholder');
    const taskButton = screen.getByRole('button', { name: /订单 A 粗加工/ });

    dispatchPointer(taskButton, 'pointerdown', 100);
    dispatchPointer(taskButton, 'pointermove', 200);
    dispatchPointer(taskButton, 'pointerup', 200);

    await waitFor(() => {
      expect(patchBody).toMatchObject({
        start_time: '2026-06-30T00:00:00.000Z',
        end_time: '2026-06-30T01:45:00.000Z',
        lock_after_adjust: false,
      });
    });
    expect(await screen.findByText('已提交，待后端重校验')).toBeInTheDocument();
  });

  it('blocks a conflicting drag with an overlap prompt and sends no PATCH', async () => {
    const user = userEvent.setup();
    let patchCalls = 0;
    const customBoard: ScheduleBoard = {
      resources: [{ id: 'line-1', name: '产线 1' }],
      tasks: [
        { id: 'SCH-1', title: '订单 A 粗加工', resourceId: 'line-1', startDay: 0, durationDays: 3, status: 'solved', planVersion: 'M5-PLAN-20260727-V2' },
        { id: 'SCH-4', title: '订单 D 精加工', resourceId: 'line-1', startDay: 5, durationDays: 2, status: 'draft', planVersion: 'M5-PLAN-20260727-V2' },
      ],
      conflicts: [],
    };
    server.use(
      http.get('/api/m5/schedules/current', () => HttpResponse.json(m5Envelope(customBoard))),
      http.patch('/api/m5/schedules/:planVersion/operations/:orderId/:operationId', async ({ request }) => {
        patchCalls += 1;
        await request.json().catch(() => ({}));
        return HttpResponse.json(m5Envelope({}));
      }),
    );

    renderWithApp(<ScheduleGanttPage />);

    await screen.findByTestId('gantt-placeholder');
    const taskButton = screen.getByRole('button', { name: /订单 A 粗加工/ });

    dispatchPointer(taskButton, 'pointerdown', 100);
    dispatchPointer(taskButton, 'pointermove', 508.8);
    dispatchPointer(taskButton, 'pointerup', 508.8);

    expect(await screen.findByText('排程冲突')).toBeInTheDocument();
    expect(screen.getByText(/时间重叠/)).toBeInTheDocument();
    expect(patchCalls).toBe(0);

    await user.click(screen.getByRole('button', { name: '知道了' }));
  });

  it('rolls back the optimistic position when the adjustment PATCH fails', async () => {
    server.use(http.patch('/api/m5/schedules/:planVersion/operations/:orderId/:operationId', () => HttpResponse.json({ message: 'fail' }, { status: 500 })));

    const { queryClient } = renderWithApp(<ScheduleGanttPage />);

    await screen.findByTestId('gantt-placeholder');
    const taskButton = screen.getByRole('button', { name: /订单 A 粗加工/ });

    dispatchPointer(taskButton, 'pointerdown', 100);
    dispatchPointer(taskButton, 'pointermove', 424);
    dispatchPointer(taskButton, 'pointerup', 424);

    expect(await screen.findByText('排程调整失败')).toBeInTheDocument();
    await waitFor(() => {
      const board = queryClient.getQueryData<ScheduleBoard>(['schedule-board']);
      expect(board?.tasks.find((item) => item.id === 'SCH-1')?.startDay).toBe(0);
    });
    expect(within(screen.getByTestId('gantt-placeholder')).getByRole('button', { name: /订单 A 粗加工/ })).toBeInTheDocument();
  });

  it('disables drag interaction when the role lacks schedule:write', async () => {
    let patchCalls = 0;
    server.use(
      http.patch('/api/m5/schedules/:planVersion/operations/:orderId/:operationId', async ({ request }) => {
        patchCalls += 1;
        await request.json().catch(() => ({}));
        return HttpResponse.json(m5Envelope({}));
      }),
    );
    window.localStorage.setItem('mockRoleId', 'team-leader');

    renderWithApp(<ScheduleGanttPage />);

    await screen.findByTestId('gantt-placeholder');
    const taskButton = screen.getByRole('button', { name: /订单 A 粗加工/ });
    expect(taskButton).toHaveClass('gantt-task-drag-disabled');

    dispatchPointer(taskButton, 'pointerdown', 100);
    dispatchPointer(taskButton, 'pointermove', 305.28);
    dispatchPointer(taskButton, 'pointerup', 305.28);

    expect(await screen.findByText('当前角色无排程调整权限（需要 schedule:write）')).toBeInTheDocument();
    expect(patchCalls).toBe(0);
  });

  it('revokes schedule writes when the authenticated identity is downgraded to read-only', async () => {
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    vi.stubEnv('VITE_ENABLE_DEMO_ROLES', 'false');
    useAuthStore.setState({ status: 'ready', me: authenticatedMe(), error: undefined });
    const { queryClient } = renderWithApp(<ScheduleGanttPage />);

    await screen.findByTestId('gantt-placeholder');
    expect(screen.getByTestId('schedule-replan-button')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /订单 A 粗加工/ })).not.toHaveClass('gantt-task-drag-disabled');

    await act(async () => {
      queryClient.setQueryData(
        [...currentRoleQueryKey, 'pmc-reader', 'tenant-a', 'session-b', ['pmc-reader'], ['schedule:read']],
        { id: 'pmc-reader', name: 'PMC 只读用户', permissions: ['schedule:read'] },
      );
      useAuthStore.setState({
        me: authenticatedMe({
          principal_id: 'pmc-reader',
          user: { name: 'PMC 只读用户' },
          roles: ['pmc-reader'],
          permissions: ['schedule:read'],
          session: { id: 'session-b', csrf_token: 'test-only-b', idle_expires_at: 'later', absolute_expires_at: 'later' },
        }),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => expect(screen.queryByTestId('schedule-replan-button')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /订单 A 粗加工/ })).toHaveClass('gantt-task-drag-disabled');
  });

  it('renders the capacity load heatmap computed from schedule tasks', async () => {
    renderWithApp(<ScheduleGanttPage />);

    await screen.findByTestId('gantt-placeholder');
    const capacity = await screen.findByTestId('capacity-load');
    expect(within(capacity).getByText(/产能负载（按日）/)).toBeInTheDocument();
    expect(within(capacity).getByTestId('capacity-stacked')).toBeInTheDocument();
    expect(within(capacity).getByText('总负载')).toBeInTheDocument();
    expect(within(capacity).getAllByRole('cell').length).toBeGreaterThan(0);
  });

  it('shows the dependency endpoint note when dependencies are empty and renders no link svg', async () => {
    server.use(http.get('/api/m5/schedules/current/dependencies', () => HttpResponse.json(m5Envelope([]))));

    renderWithApp(<ScheduleGanttPage />);

    await screen.findByTestId('gantt-placeholder');
    expect(await screen.findByText('依赖端点未提供')).toBeInTheDocument();
    expect(screen.queryByTestId('gantt-links-svg')).not.toBeInTheDocument();
  });

  it('zooms with the today and focus task toolbar buttons', async () => {
    const now = Date.UTC(2026, 6, 27);
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const user = userEvent.setup();

    renderWithApp(<ScheduleGanttPage />);

    await screen.findByTestId('gantt-placeholder');
    expect(useWorkbenchStore.getState().ganttWindow).toBeNull();

    await user.click(screen.getByRole('button', { name: '今天' }));
    expect(useWorkbenchStore.getState().ganttWindow).not.toBeNull();

    await user.click(screen.getByRole('button', { name: /订单 A 粗加工/ }));
    await user.click(screen.getByRole('button', { name: '聚焦任务' }));
    expect(useWorkbenchStore.getState().ganttWindow).toEqual({ startDay: 0, endDay: 4 });

    await user.click(screen.getByRole('button', { name: '清除时间窗' }));
    expect(useWorkbenchStore.getState().ganttWindow).toBeNull();
  });

  it('switches to the month scale from the toolbar', async () => {
    renderWithApp(<ScheduleGanttPage />);

    await screen.findByTestId('gantt-placeholder');
    await userEvent.click(screen.getByText('月'));

    expect(useWorkbenchStore.getState().scheduleScale).toBe('month');
    expect((await screen.findAllByText(/2026-0[67]/)).length).toBeGreaterThan(0);
  });

  it('locks a task from the detail drawer and refetches the schedule board', async () => {
    const user = userEvent.setup();
    let lockCalls = 0;
    let boardGets = 0;
    server.use(
      http.get('/api/m5/schedules/current', () => {
        boardGets += 1;
        return HttpResponse.json(m5Envelope(scheduleBoardFixture));
      }),
      http.post('/api/m5/schedules/:planVersion/operations/:orderId/:operationId/lock', async ({ request }) => {
        lockCalls += 1;
        await request.json().catch(() => ({}));
        return HttpResponse.json(m5Envelope({ locked: true }));
      }),
    );

    renderWithApp(<ScheduleGanttPage />);

    await screen.findByTestId('gantt-placeholder');
    expect(boardGets).toBe(1);
    await user.click(screen.getByRole('button', { name: /订单 A 粗加工/ }));
    await user.click(await screen.findByRole('button', { name: '锁定工序' }));

    await waitFor(() => expect(lockCalls).toBe(1));
    await waitFor(() => expect(boardGets).toBe(2));
  });

  it('shows locked bars as drag disabled and unlocks from the drawer', async () => {
    const user = userEvent.setup();
    let unlockCalls = 0;
    const customBoard: ScheduleBoard = {
      resources: [{ id: 'line-1', name: '产线 1' }],
      tasks: [
        {
          id: 'SCH-1',
          title: '订单 A 粗加工',
          resourceId: 'line-1',
          startDay: 0,
          durationDays: 3,
          status: 'adjusted',
          rawStatus: 'locked',
          planVersion: 'M5-PLAN-20260727-V2',
        },
      ],
      conflicts: [],
    };
    server.use(
      http.get('/api/m5/schedules/current', () => HttpResponse.json(m5Envelope(customBoard))),
      http.post('/api/m5/schedules/:planVersion/operations/:orderId/:operationId/unlock', async ({ request }) => {
        unlockCalls += 1;
        await request.json().catch(() => ({}));
        return HttpResponse.json(m5Envelope({ locked: false }));
      }),
    );

    renderWithApp(<ScheduleGanttPage />);

    await screen.findByTestId('gantt-placeholder');
    const taskButton = screen.getByRole('button', { name: /订单 A 粗加工/ });
    expect(taskButton).toHaveClass('gantt-task-drag-disabled');

    await user.click(taskButton);
    await user.click(await screen.findByRole('button', { name: '解锁工序' }));

    await waitFor(() => expect(unlockCalls).toBe(1));
  });
});
