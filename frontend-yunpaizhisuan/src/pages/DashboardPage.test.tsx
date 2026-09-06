import { http, HttpResponse } from 'msw';
import { readFile } from 'node:fs/promises';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { server } from '../mocks/server';
import { renderWithApp } from '../tests/testUtils';
import { DashboardPage } from './DashboardPage';

const finishedGoodsFixture = {
  items: [
    {
      material_id: 'MAT-FG-001',
      material_code: 'MAT-FG-001',
      name: '成品A',
      unit: 'pcs',
      balance: { quantity_on_hand: 100, quantity_available: 90, quantity_blocked: 10 },
      produced_total: 120,
      defect_total: 4,
      good_total: 116,
      yield_rate: 0.9667,
      lots: ['LOT-A'],
      yield_summary: [{ operation_id: 'OP-10', yield_rate: 0.97, produced: 60, defect: 2 }],
    },
  ],
  totals: { produced_total: 120, defect_total: 4, good_total: 116 },
};

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-probe">{location.pathname}</span>;
}

function renderDashboard() {
  return renderWithApp(
    <MemoryRouter initialEntries={['/dashboard']}>
      <DashboardPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('DashboardPage', () => {
  it('renders loading state before data resolves', () => {
    const { container } = renderDashboard();

    expect(container.querySelector('.ant-spin')).toBeInTheDocument();
  });

  it('renders normal dashboard data', async () => {
    renderDashboard();

    expect(await screen.findByText('业务 KPI 与运营风险驾驶舱')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '业务追踪' })).toHaveAttribute('href', '/business.html');
    expect(screen.getByRole('link', { name: '业务追踪' })).toHaveAttribute('target', '_blank');
    expect(await screen.findByText('最近 Agent 活动')).toBeInTheDocument();
    expect(await screen.findByText('风险三色卡')).toBeInTheDocument();
    expect(await screen.findByText('经营 KPI')).toBeInTheDocument();
    expect(screen.queryByText(/M7|高风险终审/)).not.toBeInTheDocument();
  });

  it('navigates into the cockpit from the dashboard header', async () => {
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole('button', { name: '进入驾驶舱' }));

    expect(screen.getByTestId('location-probe')).toHaveTextContent('/cockpit');
  });

  it('keeps the Dashboard fixture free of M7 legal activity', async () => {
    const fixture = await readFile('src/mocks/fixtures/dashboard.json', 'utf8');

    expect(fixture).not.toMatch(/M7|法务|终审/i);
    expect(fixture).toContain('供应商关键件交期回复已更新');
  });

  it('renders KPI cards with computed values from mocked sources', async () => {
    server.use(
      http.get('/api/orchestrator/business-finished-goods', () => HttpResponse.json(finishedGoodsFixture)),
    );

    renderDashboard();

    expect((await screen.findAllByText('本月订单数')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('缺料物料数').length).toBeGreaterThan(0);
    expect(screen.getAllByText('逾期采购金额').length).toBeGreaterThan(0);
    expect(screen.getAllByText('在产工单数').length).toBeGreaterThan(0);
    expect(screen.getAllByText('准交率').length).toBeGreaterThan(0);
    expect(screen.getAllByText('良率').length).toBeGreaterThan(0);

    expect(await screen.findByText(/66\.7%/)).toBeInTheDocument();
    expect(screen.getByText(/¥245\.80/)).toBeInTheDocument();
    expect(screen.getByText(/96\.7%/)).toBeInTheDocument();
    expect(screen.getAllByText('2', { selector: '.dashboard-kpi-value' }).length).toBeGreaterThanOrEqual(2);
  });

  it('skips order-scoped readiness and marks the KPI unavailable without an order', async () => {
    let readinessCalls = 0;
    server.use(
      http.get('/api/m3/material-readiness', () => {
        readinessCalls += 1;
        return HttpResponse.json({ success: true, data: { lines: [] }, errors: [] });
      }),
    );

    renderDashboard();

    const shortageCard = await screen.findByRole('link', { name: '进入 缺料物料数' });
    await waitFor(() => expect(within(shortageCard).getByText('暂无数据')).toBeInTheDocument());
    expect(within(shortageCard).getByText('--')).toBeInTheDocument();
    expect(readinessCalls).toBe(0);
  });

  it('renders risk three-color cards and navigates to the purchase page', async () => {
    const user = userEvent.setup();
    renderDashboard();

    expect(await screen.findByText('高风险 · 逾期/缺料')).toBeInTheDocument();
    expect(screen.getByText('中风险 · 临期/关注')).toBeInTheDocument();
    expect(screen.getByText('正常 · 稳定运行')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /风险卡：高风险/ }));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/modules/purchase-warnings');
  });

  it('renders the KPI risk area as friendly error when finished-goods is unavailable', async () => {
    server.use(
      http.get('/api/orchestrator/business-finished-goods', () => HttpResponse.json({ message: 'Unavailable' }, { status: 500 })),
    );

    renderDashboard();

    expect((await screen.findAllByText('良率')).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('良率 数据加载失败')).toBeInTheDocument();
  });

  it('renders unavailable module states when health checks fail', async () => {
    const user = userEvent.setup();
    server.use(
      ...['/api/m0/parser-compat/health', '/api/m2/health', '/api/m3/health', '/api/m4/health', '/api/m5/health'].map((path) =>
        http.get(path, () => HttpResponse.json({ message: 'Unavailable' }, { status: 503 })),
      ),
    );

    renderDashboard();

    expect(await screen.findByText('当前有 5 个高风险模块需要处理')).toBeInTheDocument();

    const dangerHeader = await screen.findByRole('link', { name: /风险卡：高风险/ });
    const dangerCard = dangerHeader.closest('.ant-card') as HTMLElement | null;
    expect(dangerCard).not.toBeNull();
    for (const panel of ['M1（1）', 'M2（1）', 'M3（1）', 'M4（2）', 'M5（1）']) {
      await user.click(within(dangerCard!).getByText(panel));
    }

    expect((await screen.findAllByText('网关无法连接模块服务。')).length).toBe(5);
  });

  it('treats the M2 ready health state as normal', async () => {
    server.use(http.get('/api/m2/health', () => HttpResponse.json({ health: { status: 'ready' } })));

    renderDashboard();

    expect(await screen.findByText('订单到排程 服务连接正常')).toBeInTheDocument();
    expect(screen.queryByText('M2 BOM/SOP需要关注')).not.toBeInTheDocument();
  });

  it('renders a warning for a reachable non-ok module', async () => {
    const user = userEvent.setup();
    server.use(http.get('/api/m3/health', () => HttpResponse.json({ status: 'degraded' })));

    renderDashboard();

    const warningHeader = await screen.findByRole('link', { name: /风险卡：中风险/ });
    const warningCard = warningHeader.closest('.ant-card') as HTMLElement | null;
    expect(warningCard).not.toBeNull();
    await user.click(within(warningCard!).getByText('M3（1）'));

    expect(await screen.findByText('M3 物料计划需要关注')).toBeInTheDocument();
    expect(await screen.findByText('后端返回状态：degraded')).toBeInTheDocument();
  });

  it('navigates to the M4 page from the M4 dashboard card', async () => {
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole('link', { name: '进入 M4 采购追踪' }));

    expect(screen.getByTestId('location-probe')).toHaveTextContent('/modules/purchase-warnings');
  });

  it('navigates module cards with click and keyboard activation', async () => {
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole('link', { name: '进入 M0 订单解析' }));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/modules/m0-review');

    const bomLink = await screen.findByRole('link', { name: '进入 M2 BOM/SOP' });
    bomLink.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/modules/bom-review');

    const scheduleLink = await screen.findByRole('link', { name: '进入 M5 PMC 排程' });
    scheduleLink.focus();
    await user.keyboard(' ');
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/modules/m5-flow');

    await user.click(await screen.findByRole('link', { name: '进入 M3 物料计划' }));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/modules/m3-procurement');
  });

  it('exposes a page link for every health module', async () => {
    renderDashboard();

    expect(await screen.findByRole('link', { name: '进入 M0 订单解析' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '进入 M2 BOM/SOP' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '进入 M3 物料计划' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '进入 M4 采购追踪' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '进入 M5 PMC 排程' })).toBeInTheDocument();
  });

  it('renders KPI secondary values for current and cumulative periods', async () => {
    server.use(
      http.get('/api/orchestrator/business-finished-goods', () => HttpResponse.json(finishedGoodsFixture)),
    );

    renderDashboard();

    expect(await screen.findByText('累计 2')).toBeInTheDocument();
    expect(screen.getByText('逾期单 1')).toBeInTheDocument();
    const shortageCard = screen.getByRole('link', { name: '进入 缺料物料数' });
    expect(within(shortageCard).getByText('--')).toBeInTheDocument();
    expect(within(shortageCard).queryByText(/缺料总量/)).not.toBeInTheDocument();
    expect(screen.getByText('逾期笔数 1')).toBeInTheDocument();
    expect(screen.getByText('成品 1')).toBeInTheDocument();
  });

  it('renders goal progress for rate KPIs from the static targets', async () => {
    server.use(
      http.get('/api/orchestrator/business-finished-goods', () => HttpResponse.json(finishedGoodsFixture)),
    );

    renderDashboard();

    const bars = await screen.findAllByRole('progressbar');
    expect(bars.some((bar) => bar.getAttribute('aria-valuenow') === '74')).toBe(true);
    expect(bars.some((bar) => bar.getAttribute('aria-valuenow') === '100')).toBe(true);
  });

  it('retries a failed KPI source from the card retry button', async () => {
    let calls = 0;
    server.use(
      http.get('/api/orchestrator/business-finished-goods', () => {
        calls += 1;
        return HttpResponse.json({ message: 'Unavailable' }, { status: 500 });
      }),
    );
    const user = userEvent.setup();

    renderDashboard();

    const errorCard = await screen.findByLabelText('良率 数据加载失败');
    const retryButton = within(errorCard).getByRole('button', { name: /重试/ });
    expect(retryButton).toBeInTheDocument();

    await user.click(retryButton);
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2));
  });

  it('refreshes all KPI sources from the page refresh button', async () => {
    let calls = 0;
    server.use(
      http.get('/api/m4/tracking', () => {
        calls += 1;
        return HttpResponse.json({ items: [], page: 1, page_size: 20, total: 0 });
      }),
    );
    const user = userEvent.setup();

    renderDashboard();

    const refreshButton = await screen.findByRole('button', { name: '刷新' });
    await user.click(refreshButton);
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2));
  });

  it('renders the risk module matrix aggregated by module and severity', async () => {
    renderDashboard();

    expect(await screen.findByText('模块 × 风险级别矩阵')).toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: 'M3' })).not.toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'M4' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'M5' })).toBeInTheDocument();
  });

  it('drills down into risk items and opens the detail drawer', async () => {
    const user = userEvent.setup();
    renderDashboard();

    await screen.findByText('高风险 · 逾期/缺料');
    await user.click(screen.getByText('M4（1）'));

    expect(await screen.findByText('轴承 逾期 4 天')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '风险条目：轴承 逾期 4 天' }));

    expect(await screen.findByText('去处理')).toBeInTheDocument();
    expect(screen.getAllByText(/华东五金供应商 · PO-20260703-001/).length).toBeGreaterThanOrEqual(1);
  });

  it('navigates from the risk detail drawer action to the module page', async () => {
    const user = userEvent.setup();
    renderDashboard();

    await screen.findByText('高风险 · 逾期/缺料');
    await user.click(screen.getByText('M4（1）'));
    await user.click(await screen.findByRole('button', { name: '风险条目：轴承 逾期 4 天' }));

    const handleButton = await screen.findByRole('button', { name: '去处理' });
    await user.click(handleButton);

    expect(screen.getByTestId('location-probe')).toHaveTextContent('/modules/purchase-warnings');
  });
});
