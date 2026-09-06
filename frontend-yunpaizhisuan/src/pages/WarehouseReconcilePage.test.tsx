import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { server } from '../mocks/server';
import { renderWithApp } from '../tests/testUtils';
import { WarehouseReconcilePage } from './WarehouseReconcilePage';


const varianceReport = {
  tenant_id: 'default',
  items: [
    {
      variance_id: 'var-1',
      order_id: 'SO-1',
      run_id: 'flow-1',
      material_id: 'MAT-1',
      material_code: 'MAT-1',
      material_name: '轴承',
      unit: 'PCS',
      demand: '20',
      standard_qty: '21',
      actual_qty: '23',
      variance: '2',
      loss_rate: '0.05',
      yield_rate: 0.9,
      yield_adjusted: '23.333333',
      reason: '损耗',
      snapshot_ts: '2026-08-10T00:00:00Z',
      data_quality: { has_issue_data: true, pending_flow_note: '' },
    },
    {
      variance_id: 'var-2',
      order_id: 'SO-1',
      run_id: 'flow-1',
      material_id: 'MAT-2',
      material_code: 'MAT-2',
      material_name: '线材',
      unit: 'M',
      demand: '10',
      standard_qty: '10',
      actual_qty: '0',
      variance: '-10',
      loss_rate: '0',
      yield_rate: null,
      yield_adjusted: '10',
      reason: '数据缺失',
      snapshot_ts: '2026-08-10T00:00:00Z',
      data_quality: {
        has_issue_data: false,
        pending_flow_note: '待现场流程配套',
      },
    },
  ],
  totals: {
    count: 2,
    standard_qty: '31',
    actual_qty: '23',
    variance: '-8',
    reasons: { 损耗: 1, 数据缺失: 1 },
  },
  pagination: { limit: 200, offset: 0, total: 2 },
};

const outboundFlow = {
  tenant_id: 'default',
  order_id: 'SO-1',
  order: { order_id: 'SO-1', product_id: 'FG-1' },
  materials: [
    {
      material_id: 'MAT-1',
      material_code: 'MAT-1',
      material_name: '轴承',
      unit: 'PCS',
      standard_qty: '21',
      issue_qty: 23,
      return_qty: 0,
      movements: [
        {
          movement_id: 'mov-1',
          order_id: 'SO-1',
          material_id: 'MAT-1',
          movement_type: 'issue',
          quantity: -23,
          location_id: 'WH-A',
          source_module: 'm3',
          source_event_id: 'txn-a',
          occurred_at: '2026-08-05T00:00:00Z',
        },
      ],
    },
  ],
};


describe('WarehouseReconcilePage', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders demo-mode empty state', () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubEnv('VITE_ENABLE_MSW', 'true');
    renderWithApp(<WarehouseReconcilePage />);
    expect(screen.getByRole('heading', { name: '仓库出库对账' })).toBeInTheDocument();
    expect(
      screen.getByText(
        '仓库出库对账（Demo 模式空态样例）：真实模式连接统一事实账本后展示差异账与出库流向。',
      ),
    ).toBeInTheDocument();
  });

  it('renders variance rows and opens order outbound flow', async () => {
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    server.use(
      http.get('/api/orchestrator/business-consumption-variance', () =>
        HttpResponse.json(varianceReport),
      ),
      http.post('/api/orchestrator/business-consumption-variance/refresh', () =>
        HttpResponse.json({ refreshed: 2, orders: ['SO-1'], snapshot_ts: '2026-08-10T00:00:00Z' }),
      ),
      http.get('/api/orchestrator/business-flows/:runId/outbound-flow', () =>
        HttpResponse.json(outboundFlow),
      ),
    );
    const user = userEvent.setup();
    renderWithApp(<WarehouseReconcilePage />);

    expect((await screen.findAllByText('SO-1')).length).toBeGreaterThan(0);
    expect(screen.getByText('轴承')).toBeInTheDocument();
    expect(screen.getByText('待现场流程配套')).toBeInTheDocument();

    const flowButtons = screen.getAllByRole('button', { name: /出库流向/ });
    expect(flowButtons.length).toBeGreaterThan(0);
    await user.click(flowButtons[0]!);
    expect(await screen.findByText('订单出库流向：SO-1')).toBeInTheDocument();
    expect(screen.getByText('issue')).toBeInTheDocument();
    expect(screen.getByText('txn-a')).toBeInTheDocument();
  });
});
