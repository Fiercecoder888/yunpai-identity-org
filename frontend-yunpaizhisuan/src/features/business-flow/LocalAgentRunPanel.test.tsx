import userEvent from '@testing-library/user-event';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithApp } from '../../tests/testUtils';
import * as localRunApi from '../../services/localRunApi';
import { LOCAL_ORDER_REGISTRY_KEY } from './localOrderRegistry';
import { LocalAgentRunPanel } from './LocalAgentRunPanel';

const ORDER = {
  orderId: 'PO-20260807-003',
  filename: 'PO-20260807-003.xlsx',
  productName: 'W-H915',
  updatedAt: '2026-09-08T06:00:00Z',
};

const RUN = {
  run_id: 'run-delete-1',
  status: 'completed',
  request: {
    message: '请解析订单 PO-20260807-003',
    document: { order_id: 'PO-20260807-003' },
  },
};

describe('LocalAgentRunPanel delete order', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(LOCAL_ORDER_REGISTRY_KEY, JSON.stringify([ORDER]));
    vi.spyOn(localRunApi, 'listLocalRuns').mockResolvedValue([RUN]);
    vi.spyOn(localRunApi, 'getLocalRun').mockResolvedValue(RUN);
    vi.spyOn(localRunApi, 'deleteLocalRuns').mockResolvedValue([RUN.run_id]);
  });

  it('deletes an order with its runs after confirmation', async () => {
    const user = userEvent.setup();
    renderWithApp(<LocalAgentRunPanel />);

    expect(await screen.findByText(/当前查看订单：PO-20260807-003/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /删除订单 PO-20260807-003/ }));
    expect(await screen.findByText(/删除订单 PO-20260807-003？/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '删 除' }));

    await waitFor(() => expect(localRunApi.deleteLocalRuns).toHaveBeenCalledWith([RUN.run_id]));
    // localStorage 注册表已清空
    expect(localStorage.getItem(LOCAL_ORDER_REGISTRY_KEY)).toBe('[]');
  });

  it('keeps the order when the delete is cancelled', async () => {
    const user = userEvent.setup();
    renderWithApp(<LocalAgentRunPanel />);

    await screen.findByText(/当前查看订单：PO-20260807-003/);
    fireEvent.click(screen.getByRole('button', { name: /删除订单 PO-20260807-003/ }));
    await user.click(await screen.findByRole('button', { name: '取 消' }));

    expect(localRunApi.deleteLocalRuns).not.toHaveBeenCalled();
    expect(localStorage.getItem(LOCAL_ORDER_REGISTRY_KEY)).not.toBe('[]');
  });
});
