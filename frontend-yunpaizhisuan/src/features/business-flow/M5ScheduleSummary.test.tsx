import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithApp } from '../../tests/testUtils';
import { server } from '../../mocks/server';
import { M5ScheduleSummary } from './M5ScheduleSummary';

const schedule = {
  plan_version: 'cp-sat-demo-1',
  solver_status: 'optimal',
  validation_passed: true,
  lifecycle_status: 'draft',
  operations: [
    { operation_id: 'OP-10', operation_name: '裁线', resource_id: 'WC-1', start_time: '2026-08-07T00:00:00Z', end_time: '2026-08-07T00:10:00Z', status: 'scheduled' },
    { operation_id: 'OP-20', operation_name: '焊接', resource_id: 'WC-2', start_time: '2026-08-07T00:10:00Z', end_time: '2026-08-07T00:30:00Z', status: 'scheduled' },
    { operation_id: 'OP-30', operation_name: '组装', resource_id: 'WC-3', start_time: '2026-08-07T00:30:00Z', end_time: '2026-08-07T00:45:00Z', status: 'scheduled' },
    { operation_id: 'OP-40', operation_name: '测试', resource_id: 'WC-4', start_time: '2026-08-07T00:45:00Z', end_time: '2026-08-07T00:50:00Z', status: 'scheduled' },
  ],
  metrics: {
    order_count: 1,
    scheduled_operation_count: 4,
    on_time_order_count: 1,
    on_time_rate: 1,
    total_tardiness_minutes: 0,
    makespan_minutes: 50,
    resource_load_minutes: { 'WC-1': 10, 'WC-2': 20, 'WC-3': 15, 'WC-4': 5 },
  },
  risks: [],
  messages: [],
};

describe('M5ScheduleSummary', () => {
  it('展示排程摘要、指标、准交率与工序分行甘特', async () => {
    renderWithApp(<M5ScheduleSummary schedule={schedule} catalogId="hist-1" />);

    expect(screen.getByText(/排程摘要/)).toBeInTheDocument();
    expect(screen.getByText('cp-sat-demo-1')).toBeInTheDocument();
    expect(screen.getByText('optimal')).toBeInTheDocument();
    expect(await screen.findByText('SO-PMC-001')).toBeInTheDocument();
    expect(screen.getByText('准交率').nextElementSibling).toHaveTextContent('—');
    expect(screen.getByText('裁线')).toBeInTheDocument();
    expect(screen.getByText('焊接')).toBeInTheDocument();
    expect(screen.getByText('组装')).toBeInTheDocument();
    expect(screen.getByText('测试')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '业务明细' })).toHaveAttribute(
      'href',
      '/business.html?catalog_id=hist-1&action=view&module=m5',
    );
  });

  it('明确标识模拟工艺 PMC 不可发布或派工', () => {
    renderWithApp(<M5ScheduleSummary schedule={schedule} simulatedEngineeringRoute />);

    expect(screen.getByText('模拟工艺 · 不可发布/派工')).toBeInTheDocument();
  });

  it('可切换时间轴汇总甘特，并可收起/展开', async () => {
    const user = userEvent.setup();
    renderWithApp(<M5ScheduleSummary schedule={schedule} />);

    fireEvent.click(screen.getByText('时间轴汇总'));
    expect(screen.getByText('裁线')).toBeInTheDocument();
    expect(screen.getByText('焊接')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '收起排程摘要' }));
    expect(screen.queryByText('执行进展')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '展开排程摘要' }));
    expect(screen.getByText('执行进展')).toBeInTheDocument();
  });

  it('展示 nullable 准交率并可展开订单工位的实际进度', async () => {
    const user = userEvent.setup();
    renderWithApp(<M5ScheduleSummary schedule={schedule} />);

    expect(await screen.findByText('SO-PMC-001')).toBeInTheDocument();
    const wipMetric = screen.getAllByText('在制').find((node) => node.nextElementSibling?.tagName === 'B');
    expect(wipMetric?.nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('准交率').nextElementSibling).toHaveTextContent('—');

    await user.click(screen.getByRole('button', { name: /SO-PMC-001/ }));
    expect(await screen.findByLabelText('SO-PMC-001 工位进度')).toHaveTextContent('裁线');
    expect(screen.getByTestId('m5-pmc-actual-bar')).toBeInTheDocument();
  });

  it('does not request progress without a plan version and shows an explicit empty state', () => {
    renderWithApp(<M5ScheduleSummary schedule={undefined} />);

    expect(screen.getByText('PMC 数据未完善')).toBeInTheDocument();
  });

  it('refreshes PMC progress from a stable icon button', async () => {
    const user = userEvent.setup();
    let progressGets = 0;
    server.use(http.get('/api/m5/pmc/progress', () => {
      progressGets += 1;
      return HttpResponse.json({
        success: true,
        data: {
          plan_version: 'cp-sat-demo-1',
          generated_at: '2026-08-20T08:30:00Z',
          summary: { order_count: 0, completed_order_count: 0, wip_order_count: 0, late_order_count: 0, on_time_order_count: 0, on_time_rate_percent: null },
          orders: [],
        },
      });
    }));

    renderWithApp(<M5ScheduleSummary schedule={schedule} />);
    await waitFor(() => expect(progressGets).toBe(1));
    const refresh = screen.getByRole('button', { name: '刷新 PMC 进度' });
    expect(refresh).toHaveClass('ant-btn-circle');
    await user.click(refresh);
    await waitFor(() => expect(progressGets).toBe(2));
  });

  it('polls PMC progress and execution summary every ten seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let progressGets = 0;
    let executionGets = 0;
    server.use(
      http.get('/api/m5/pmc/progress', () => {
        progressGets += 1;
        return HttpResponse.json({
          success: true,
          data: {
            plan_version: 'cp-sat-demo-1',
            generated_at: '2026-08-20T08:30:00Z',
            summary: { order_count: 0, completed_order_count: 0, wip_order_count: 0, late_order_count: 0, on_time_order_count: 0, on_time_rate_percent: null },
            orders: [],
          },
        });
      }),
      http.get('/api/m5/schedules/:planVersion/execution-summary', ({ params }) => {
        executionGets += 1;
        return HttpResponse.json({
          success: true,
          data: {
            plan_version: String(params.planVersion),
            event_count: 0,
            latest_event_at: null,
            average_start_deviation_minutes: null,
            average_end_deviation_minutes: null,
            max_abs_end_deviation_minutes: null,
            late_operation_count: 0,
            exception_count: 0,
            scrap_quantity: 0,
            planned_operation_count: 4,
            started_operation_count: 0,
            completed_operation_count: 0,
            paused_operation_count: 0,
            exception_operation_count: 0,
            completion_rate_percent: 0,
            source_event_counts: {},
          },
        });
      }),
    );

    try {
      renderWithApp(<M5ScheduleSummary schedule={schedule} />);
      await waitFor(() => {
        expect(progressGets).toBeGreaterThanOrEqual(1);
        expect(executionGets).toBeGreaterThanOrEqual(1);
      });
      const initialProgressGets = progressGets;
      const initialExecutionGets = executionGets;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      await waitFor(() => {
        expect(progressGets).toBeGreaterThan(initialProgressGets);
        expect(executionGets).toBeGreaterThan(initialExecutionGets);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps backend PMC order and operation statuses to Chinese labels', async () => {
    const user = userEvent.setup();
    const statuses = ['not_started', 'paused', 'exception', 'scrapped'] as const;
    server.use(http.get('/api/m5/pmc/progress', () => HttpResponse.json({
      success: true,
      data: {
        plan_version: 'cp-sat-demo-1',
        generated_at: '2026-08-20T08:30:00Z',
        summary: { order_count: 1, completed_order_count: 0, wip_order_count: 0, late_order_count: 0, on_time_order_count: 0, on_time_rate_percent: null },
        orders: [{
          order_id: 'SO-STATUS',
          product_id: 'P-STATUS',
          actual_quantity_supported: false,
          status: 'unknown',
          on_time: null,
          operations: statuses.map((actualStatus, index) => ({
            order_id: 'SO-STATUS',
            product_id: 'P-STATUS',
            operation_id: `OP-${index + 1}`,
            operation_name: `工序 ${index + 1}`,
            resource_id: `WC-${index + 1}`,
            planned_start_time: '2026-08-20T08:00:00Z',
            planned_end_time: '2026-08-20T09:00:00Z',
            actual_status: actualStatus,
          })),
        }],
      },
    })));

    renderWithApp(<M5ScheduleSummary schedule={schedule} />);
    const row = await screen.findByRole('button', { name: /SO-STATUS/ });
    expect(row).toHaveTextContent('未知');
    await user.click(row);
    const details = await screen.findByLabelText('SO-STATUS 工位进度');
    for (const label of ['未开始', '已暂停', '异常', '已报废']) {
      expect(within(details).getByText(label)).toBeInTheDocument();
    }
  });

  it('shows unsupported order quantity as unavailable instead of zero progress', async () => {
    const user = userEvent.setup();
    server.use(http.get('/api/m5/pmc/progress', () => HttpResponse.json({
      success: true,
      data: {
        plan_version: 'cp-sat-demo-1',
        generated_at: '2026-08-20T08:30:00Z',
        summary: {
          order_count: 1,
          completed_order_count: 0,
          wip_order_count: 1,
          late_order_count: 0,
          on_time_order_count: 0,
          on_time_rate_percent: null,
        },
        orders: [{
          order_id: 'SO-UNSUPPORTED',
          product_id: 'P-1',
          planned_quantity: null,
          unit: null,
          due_time: null,
          actual_qty: null,
          actual_quantity_supported: false,
          terminal_operation_id: null,
          completion_rate_percent: null,
          planned_completion_time: null,
          actual_completion_time: null,
          status: 'wip',
          on_time: null,
          operations: [{
            order_id: 'SO-UNSUPPORTED',
            product_id: 'P-1',
            operation_id: 'OP-UNKNOWN',
            operation_name: '待确认工序',
            resource_id: 'WC-UNKNOWN',
            planned_start_time: '2026-08-20T08:00:00Z',
            planned_end_time: '2026-08-20T09:00:00Z',
            planned_quantity: null,
            unit: null,
            actual_start_time: null,
            actual_end_time: null,
            actual_qty: null,
            actual_status: 'not_started',
            completion_rate_percent: null,
          }],
        }],
      },
    })));
    renderWithApp(<M5ScheduleSummary schedule={schedule} />);

    const row = await screen.findByRole('button', { name: /SO-UNSUPPORTED/ });
    expect(row).toHaveTextContent('未提供');
    expect(row).not.toHaveTextContent('0%');
    expect(row.querySelector('[role="progressbar"]')).not.toBeInTheDocument();
    expect(screen.getByText('准交率').nextElementSibling).toHaveTextContent('—');
    await user.click(row);
    const operationDetails = await screen.findByLabelText('SO-UNSUPPORTED 工位进度');
    expect(operationDetails).toHaveTextContent('待确认工序');
    expect(operationDetails).toHaveTextContent('未提供');
    expect(operationDetails.querySelector('[role="progressbar"]')).not.toBeInTheDocument();
  });

  it('caps only the progress bar while preserving truthful overproduction text', async () => {
    server.use(http.get('/api/m5/pmc/progress', () => HttpResponse.json({
      success: true,
      data: {
        plan_version: 'cp-sat-demo-1',
        generated_at: '2026-08-20T08:30:00Z',
        summary: {
          order_count: 1,
          completed_order_count: 1,
          wip_order_count: 0,
          late_order_count: 0,
          on_time_order_count: 1,
          on_time_rate_percent: 100,
        },
        orders: [{
          order_id: 'SO-OVERPRODUCED',
          product_id: 'P-OVER',
          planned_quantity: 10,
          unit: 'pcs',
          due_time: '2026-08-21T09:00:00Z',
          actual_qty: 12,
          actual_quantity_supported: true,
          terminal_operation_id: 'OP-LAST',
          completion_rate_percent: 120,
          planned_completion_time: '2026-08-20T09:00:00Z',
          actual_completion_time: '2026-08-20T08:50:00Z',
          status: 'completed',
          on_time: true,
          operations: [],
        }],
      },
    })));
    renderWithApp(<M5ScheduleSummary schedule={schedule} />);

    const row = await screen.findByRole('button', { name: /SO-OVERPRODUCED/ });
    expect(row).toHaveTextContent('12 pcs');
    expect(row).toHaveTextContent('120%');
    expect(row.querySelector('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '100');
  });

  it('does not guess an actual projection when two orders reuse the same operation id', async () => {
    const operation = (orderId: string, actualQty: number) => ({
      order_id: orderId,
      product_id: `P-${orderId}`,
      operation_id: 'OP-10',
      operation_name: '裁线',
      resource_id: `WC-${orderId}`,
      planned_start_time: '2026-08-20T08:00:00Z',
      planned_end_time: '2026-08-20T09:00:00Z',
      planned_quantity: 10,
      unit: 'pcs',
      actual_start_time: '2026-08-20T08:05:00Z',
      actual_end_time: '2026-08-20T08:30:00Z',
      actual_qty: actualQty,
      actual_status: 'completed',
      completion_rate_percent: actualQty * 10,
    });
    const order = (orderId: string, actualQty: number) => ({
      order_id: orderId,
      product_id: `P-${orderId}`,
      planned_quantity: 10,
      unit: 'pcs',
      due_time: '2026-08-21T09:00:00Z',
      actual_qty: actualQty,
      actual_quantity_supported: true,
      terminal_operation_id: 'OP-10',
      completion_rate_percent: actualQty * 10,
      planned_completion_time: '2026-08-20T09:00:00Z',
      actual_completion_time: '2026-08-20T08:30:00Z',
      status: 'completed',
      on_time: true,
      operations: [operation(orderId, actualQty)],
    });
    server.use(http.get('/api/m5/pmc/progress', () => HttpResponse.json({
      success: true,
      data: {
        plan_version: 'cp-sat-demo-1',
        generated_at: '2026-08-20T08:30:00Z',
        summary: {
          order_count: 2,
          completed_order_count: 2,
          wip_order_count: 0,
          late_order_count: 0,
          on_time_order_count: 2,
          on_time_rate_percent: 100,
        },
        orders: [order('SO-A', 4), order('SO-B', 9)],
      },
    })));

    renderWithApp(<M5ScheduleSummary schedule={schedule} />);

    expect(await screen.findByText('SO-A')).toBeInTheDocument();
    expect(screen.getByText('SO-B')).toBeInTheDocument();
    expect(screen.queryByTestId('m5-pmc-actual-bar')).not.toBeInTheDocument();
  });

  it('matches reused operation ids by resource and displays each operation unit', async () => {
    const user = userEvent.setup();
    const resourceSchedule = {
      ...schedule,
      operations: [
        { order_id: 'SO-RESOURCE', operation_id: 'OP-10', operation_name: '工位 A 裁线', resource_id: 'WC-A', start_time: '2026-08-20T08:00:00Z', end_time: '2026-08-20T09:00:00Z' },
        { order_id: 'SO-RESOURCE', operation_id: 'OP-10', operation_name: '工位 B 裁线', resource_id: 'WC-B', start_time: '2026-08-20T09:00:00Z', end_time: '2026-08-20T10:00:00Z' },
      ],
    };
    const progressOperation = (resourceId: string, actualQty: number, unit: string) => ({
      order_id: 'SO-RESOURCE',
      product_id: 'P-RESOURCE',
      operation_id: 'OP-10',
      operation_name: `${resourceId} 裁线`,
      resource_id: resourceId,
      planned_start_time: resourceId === 'WC-A' ? '2026-08-20T08:00:00Z' : '2026-08-20T09:00:00Z',
      planned_end_time: resourceId === 'WC-A' ? '2026-08-20T09:00:00Z' : '2026-08-20T10:00:00Z',
      planned_quantity: 10,
      unit,
      actual_start_time: resourceId === 'WC-A' ? '2026-08-20T08:05:00Z' : '2026-08-20T09:05:00Z',
      actual_end_time: resourceId === 'WC-A' ? '2026-08-20T08:30:00Z' : '2026-08-20T09:30:00Z',
      actual_qty: actualQty,
      actual_status: 'completed',
      completion_rate_percent: actualQty * 10,
    });
    server.use(http.get('/api/m5/pmc/progress', () => HttpResponse.json({
      success: true,
      data: {
        plan_version: 'cp-sat-demo-1',
        generated_at: '2026-08-20T10:00:00Z',
        summary: { order_count: 1, completed_order_count: 1, wip_order_count: 0, late_order_count: 0, on_time_order_count: 1, on_time_rate_percent: 100 },
        orders: [{
          order_id: 'SO-RESOURCE',
          product_id: 'P-RESOURCE',
          planned_quantity: 1,
          unit: 'batch',
          due_time: '2026-08-21T09:00:00Z',
          actual_qty: 1,
          actual_quantity_supported: true,
          terminal_operation_id: 'OP-10',
          completion_rate_percent: 100,
          planned_completion_time: '2026-08-20T10:00:00Z',
          actual_completion_time: '2026-08-20T09:30:00Z',
          status: 'completed',
          on_time: true,
          operations: [progressOperation('WC-A', 2, 'meter'), progressOperation('WC-B', 9, 'pcs')],
        }],
      },
    })));

    renderWithApp(<M5ScheduleSummary schedule={resourceSchedule} />);
    const orderRow = await screen.findByRole('button', { name: /SO-RESOURCE/ });
    await user.click(orderRow);
    const operationDetails = await screen.findByLabelText('SO-RESOURCE 工位进度');
    expect(operationDetails).toHaveTextContent('2 meter');
    expect(operationDetails).toHaveTextContent('9 pcs');
    expect(operationDetails).not.toHaveTextContent('2 batch');

    const actualBars = screen.getAllByTestId('m5-pmc-actual-bar');
    expect(actualBars).toHaveLength(2);
    const firstActualBar = actualBars[0];
    if (!firstActualBar) throw new Error('expected the first actual progress bar');
    await user.hover(firstActualBar);
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('2 meter'));
  });
});
