import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithApp } from '../tests/testUtils';
import { WorkerPage } from './WorkerPage';
import * as leaderApi from '../services/leaderApi';
import type { WorkerTask } from '../schemas/leader';

const renderWorker = () =>
  renderWithApp(
    <MemoryRouter initialEntries={['/worker']}>
      <WorkerPage />
    </MemoryRouter>,
  );

const workerTask = (overrides: Partial<WorkerTask> = {}): WorkerTask => ({
  binding_id: 'binding-worker-test',
  worker_id: 'worker-zhangsan',
  team_id: 'team-leader-a1',
  leader_user_id: 'leader-zhang',
  station: '测试工位',
  plan_version: 'cp-sat-leader-demo',
  tracking_task_id: 'task-plan-leader-demo',
  order_id: 'SO-LEADER-001',
  product_id: 'SKU-L',
  operation_id: 'OP-TEST',
  operation_name: '测试工序',
  resource_id: 'EQ-TEST',
  resource_name: '测试工位',
  planned_start_time: '2026-08-20T00:00:00Z',
  planned_end_time: '2026-08-20T01:00:00Z',
  actual_status: 'running',
  unit: 'pcs',
  ...overrides,
});

describe('WorkerPage', () => {
  afterEach(() => {
    // 注意：不要用 vi.restoreAllMocks() —— 它会清掉 setup 的 matchMedia 桩，
    // 导致 antd Modal/Select 的响应式观察器报错（后续用例 matchMedia 返回 undefined）。
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('lets the worker pick a test worker from the searchable selector and see bound orders', async () => {
    const user = userEvent.setup();
    renderWorker();

    // 从「测试人员」下拉选择 工人-张三（可搜索）
    const selector = screen.getByRole('combobox', { name: '工人工号' });
    await user.click(selector);
    await user.type(selector, '张三');
    await user.click(await screen.findByText('工人-张三'));

    expect((await screen.findAllByText('SO-LEADER-001')).length).toBe(2);
    expect(await screen.findByText('OP-10 押出')).toBeInTheDocument();
    expect(await screen.findByText('OP-20 焊接')).toBeInTheDocument();
    expect((await screen.findAllByText(/押出机 01/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('生产中')).length).toBe(2);
    expect(await screen.findByText('数据未完善')).toBeInTheDocument();
  });

  it('reports against the explicitly selected operation of a multi-operation order', async () => {
    window.localStorage.setItem('yunpai-worker-id', 'worker-zhangsan');
    const user = userEvent.setup();
    const reportSpy = vi.spyOn(leaderApi, 'reportWorkerWork');
    const { queryClient } = renderWorker();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const selectedOperation = await screen.findByText('OP-10 押出');
    const selectedRow = selectedOperation.closest('.worker-order-row');
    expect(selectedRow).not.toBeNull();
    fireEvent.click(within(selectedRow as HTMLElement).getByRole('button', { name: /^报\s*工$/ }));

    expect(await screen.findByText('报工（完工/进度反馈）')).toBeInTheDocument();
    const modal = screen.getByRole('dialog');
    // 工位/工序默认选中第一个（单工序订单自动），等待加载完成
    await waitFor(() => expect(within(modal!).getByText('工位/工序')).toBeInTheDocument());
    const qty = within(modal!).getByRole('spinbutton', { name: '报数数量' });
    await user.clear(qty);
    await user.type(qty, '300');
    await user.type(within(modal!).getByRole('textbox', { name: '报数单位' }), 'pcs');
    await user.click(within(modal!).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(reportSpy).toHaveBeenCalledWith(expect.objectContaining({
      plan_version: 'cp-sat-leader-demo',
      order_id: 'SO-LEADER-001',
      operation_id: 'OP-10',
      resource_id: 'EQ-CUT',
      event_type: 'quantity_report',
      reported_quantity: 300,
      reported_unit: 'pcs',
      idempotency_key: expect.stringMatching(/^wr-[a-z0-9]+-[0-9a-f-]{36}$/),
    }), 'task-plan-leader-demo');
    for (const queryKey of [['m5-pmc-progress'], ['m5-execution-summary'], ['m5-schedule-detail'], ['schedule-board']]) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey });
    }
  });

  it('does not submit a quantity report without an explicit unit', async () => {
    window.localStorage.setItem('yunpai-worker-id', 'worker-zhangsan');
    const user = userEvent.setup();
    const reportSpy = vi.spyOn(leaderApi, 'reportWorkerWork');
    renderWorker();

    await screen.findByText('OP-10 押出');
    fireEvent.click(screen.getAllByRole('button', { name: /^报\s*工$/ })[0]!);

    const modal = await screen.findByRole('dialog');
    await user.type(within(modal).getByRole('spinbutton', { name: '报数数量' }), '300');
    await user.click(within(modal).getByRole('button', { name: 'OK' }));

    expect(await within(modal).findByText('请输入报数单位')).toBeInTheDocument();
    expect(reportSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('defaults a not-started operation to actual_start', async () => {
    window.localStorage.setItem('yunpai-worker-id', 'worker-zhangsan');
    const user = userEvent.setup();
    vi.spyOn(leaderApi, 'listWorkerTasks').mockResolvedValueOnce([
      workerTask({
        operation_id: 'OP-START',
        operation_name: '待开工工序',
        actual_status: 'not_started',
      }),
    ]);
    const reportSpy = vi.spyOn(leaderApi, 'reportWorkerWork');
    renderWorker();

    await user.click(await screen.findByRole('button', { name: /^开\s*工$/ }));
    const modal = await screen.findByRole('dialog');
    expect(within(modal).queryByRole('spinbutton', { name: '报数数量' })).not.toBeInTheDocument();
    await user.click(within(modal).getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(reportSpy).toHaveBeenCalledWith(expect.objectContaining({
      operation_id: 'OP-START',
      event_type: 'actual_start',
      reported_quantity: undefined,
      reported_unit: undefined,
    }), 'task-plan-leader-demo');
  });

  it('does not offer quantity reporting when the immutable plan unit is missing', async () => {
    window.localStorage.setItem('yunpai-worker-id', 'worker-zhangsan');
    const user = userEvent.setup();
    renderWorker();

    const operation = await screen.findByText('OP-20 焊接');
    const row = operation.closest('.worker-order-row');
    expect(row).not.toBeNull();
    await user.click(within(row as HTMLElement).getByRole('button', { name: /^报\s*工$/ }));
    const modal = await screen.findByRole('dialog');
    expect(within(modal).getByText('数据未完善')).toBeInTheDocument();
    expect(within(modal).queryByRole('spinbutton', { name: '报数数量' })).not.toBeInTheDocument();

    await user.click(within(modal).getByRole('combobox', { name: '报工类型' }));
    expect(screen.queryByText('报数（进度反馈）')).not.toBeInTheDocument();
    expect((await screen.findAllByText('完工')).length).toBeGreaterThan(0);
  });

  it('blocks direct reporting for paused and exception operations', async () => {
    window.localStorage.setItem('yunpai-worker-id', 'worker-zhangsan');
    vi.spyOn(leaderApi, 'listWorkerTasks').mockResolvedValueOnce([
      workerTask({ operation_id: 'OP-PAUSED', operation_name: '暂停工序', actual_status: 'paused' }),
      workerTask({ operation_id: 'OP-ERROR', operation_name: '异常工序', actual_status: 'exception' }),
    ]);
    renderWorker();

    expect(await screen.findByText('请联系组长恢复后报工')).toBeInTheDocument();
    expect(await screen.findByText('请联系组长处理异常')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /^(开\s*工|报\s*工)$/ })).toHaveLength(0);
  });

  it('reuses an idempotency key for identical retries and changes it with quantity', async () => {
    window.localStorage.setItem('yunpai-worker-id', 'worker-zhangsan');
    const user = userEvent.setup();
    const reportSpy = vi.spyOn(leaderApi, 'reportWorkerWork');
    reportSpy.mockRejectedValueOnce(new Error('temporary network failure'));
    reportSpy.mockRejectedValueOnce(new Error('temporary network failure'));
    renderWorker();

    const openFirstOperation = async () => {
      const operation = await screen.findByText('OP-10 押出');
      const row = operation.closest('.worker-order-row');
      expect(row).not.toBeNull();
      await user.click(within(row as HTMLElement).getByRole('button', { name: /^报\s*工$/ }));
      return screen.findByRole('dialog');
    };
    const fillQuantity = async (modal: HTMLElement, quantity: string) => {
      await user.type(within(modal).getByRole('spinbutton', { name: '报数数量' }), quantity);
      await user.type(within(modal).getByRole('textbox', { name: '报数单位' }), 'pcs');
    };

    const firstModal = await openFirstOperation();
    await fillQuantity(firstModal, '10');
    await user.click(within(firstModal).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(reportSpy).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(within(firstModal).getByRole('button', { name: 'OK' })).not.toBeDisabled());

    await user.click(within(firstModal).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(reportSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(firstModal).getByRole('button', { name: 'OK' })).not.toBeDisabled());
    const firstKey = reportSpy.mock.calls[0]![0].idempotency_key;
    const retryKey = reportSpy.mock.calls[1]![0].idempotency_key;
    expect(retryKey).toBe(firstKey);

    const quantity = within(firstModal).getByRole('spinbutton', { name: '报数数量' });
    await user.clear(quantity);
    await user.type(quantity, '11');
    await user.click(within(firstModal).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(reportSpy).toHaveBeenCalledTimes(3);
    expect(reportSpy.mock.calls[2]![0].idempotency_key).not.toBe(firstKey);
  });

  it('persists the selected worker id for later visits', async () => {
    const user = userEvent.setup();
    renderWorker();

    const selector = screen.getByRole('combobox', { name: '工人工号' });
    await user.click(selector);
    await user.type(selector, '李四');
    await user.click(await screen.findByText('工人-李四'));

    await waitFor(() => expect(window.localStorage.getItem('yunpai-worker-id')).toBe('worker-lisi'));
  });
});
