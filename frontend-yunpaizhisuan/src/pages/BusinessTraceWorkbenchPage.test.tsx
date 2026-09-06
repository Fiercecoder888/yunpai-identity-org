import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { server } from '../mocks/server';
import { renderWithApp } from '../tests/testUtils';
import { BusinessTraceWorkbenchPage } from './BusinessTraceWorkbenchPage';

const orderTraceFixture = {
  tenant_id: 't1',
  order_id: 'SO-VERIFY-RECALC-FINAL4',
  order: { order_id: 'SO-VERIFY-RECALC-FINAL4', lifecycle_status: 'human_input_required' },
  materials: [{ material_id: 'MAT-1', material_code: 'MAT-001', name: '轴承' }],
  order_materials: [{ material_id: 'MAT-1', required_qty: 20 }],
  inventory_balances: [{ material_id: 'MAT-1', quantity_on_hand: 50 }],
  inventory_movements: [{ material_id: 'MAT-1', movement_type: 'issue', quantity: 10 }],
  procurement_plans: [],
  procurement_plan_lines: [],
  purchase_orders: [{ purchase_order_no: 'PO-1', status: 'sent' }],
  schedule_versions: [{ plan_version: 'V1', status: 'released' }],
  business_flow_runs: [{ run_id: 'RUN-1', status: 'human_input_required' }],
};

const renderPage = () =>
  renderWithApp(
    <MemoryRouter>
      <BusinessTraceWorkbenchPage />
    </MemoryRouter>,
  );

describe('BusinessTraceWorkbenchPage', () => {
  it('renders the order trace as structured sections instead of raw JSON', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/orchestrator/business-orders/SO-VERIFY-RECALC-FINAL4/trace', () => HttpResponse.json(orderTraceFixture)),
    );

    renderPage();

    await user.click(await screen.findByRole('button', { name: '查询全链路' }));

    expect(await screen.findByText('订单全链路追溯（订单/物料/库存/采购/排程/事实账本）')).toBeInTheDocument();
    expect(screen.getAllByText('SO-VERIFY-RECALC-FINAL4').length).toBeGreaterThan(0);
    expect(screen.getAllByText('轴承').length).toBeGreaterThan(0);
    expect(screen.getAllByText('PO-1').length).toBeGreaterThan(0);
  });

  it('queries the order trace by run id for upload orders with Chinese filenames', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/orchestrator/business-flows/flow-abc123/trace', () =>
        HttpResponse.json({
          ...orderTraceFixture,
          order_id: '验收HBOM-1.csv',
          order: { order_id: '验收HBOM-1.csv', lifecycle_status: 'completed' },
          business_flow_runs: [{ run_id: 'flow-abc123', status: 'completed' }],
        }),
      ),
    );

    renderPage();

    await user.click(screen.getByText('Run ID'));
    const input = screen.getByPlaceholderText(/Run ID/);
    await user.clear(input);
    await user.type(input, 'flow-abc123');
    await user.click(screen.getByRole('button', { name: '查询全链路' }));

    expect((await screen.findAllByText('验收HBOM-1.csv')).length).toBeGreaterThan(0);
  });

  it('folds the raw JSON behind a debug collapse instead of printing it inline', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/orchestrator/business-orders/SO-VERIFY-RECALC-FINAL4/trace', () => HttpResponse.json(orderTraceFixture)),
    );

    const { container } = renderPage();

    await user.click(await screen.findByRole('button', { name: '查询全链路' }));

    expect(await screen.findByText('轴承')).toBeInTheDocument();

    const debugToggle = screen.queryByRole('button', { name: /原始 JSON（调试）/ });
    if (debugToggle) {
      expect(debugToggle).toHaveAttribute('aria-expanded', 'false');
    }
    const inlineRawPre = Array.from(container.querySelectorAll('pre')).find(
      (pre) => !pre.closest('.ant-collapse') && pre.classList.contains('raw-json-block'),
    );
    expect(inlineRawPre).toBeUndefined();
  });

  it('shows a friendly error when the trace endpoint fails', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/orchestrator/business-orders/SO-VERIFY-RECALC-FINAL4/trace', () => HttpResponse.json({ message: 'Unavailable' }, { status: 500 })),
    );

    renderPage();

    await user.click(await screen.findByRole('button', { name: '查询全链路' }));

    expect(await screen.findByText(/Unavailable/)).toBeInTheDocument();
  });
});
