import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../mocks/server';
import { renderWithApp } from '../tests/testUtils';
import { FinishedGoodsPage } from './FinishedGoodsPage';

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

const renderPage = () =>
  renderWithApp(
    <MemoryRouter>
      <FinishedGoodsPage />
    </MemoryRouter>,
  );

describe('FinishedGoodsPage', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows a demo empty sample in demo mode without calling the API', () => {
    renderPage();

    expect(screen.getByText(/Demo 模式空态样例/)).toBeInTheDocument();
  });

  it('renders structured summary and item table instead of raw JSON', async () => {
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    server.use(http.get('/api/orchestrator/business-finished-goods', () => HttpResponse.json(finishedGoodsFixture)));

    renderPage();

    expect(await screen.findByText('成品库汇总')).toBeInTheDocument();
    expect(screen.getByText('物料种类')).toBeInTheDocument();
    expect(screen.getByText('加权良率')).toBeInTheDocument();
    expect(screen.getByText('MAT-FG-001')).toBeInTheDocument();
    expect(screen.getByText('成品A')).toBeInTheDocument();
    expect(screen.getByText('96.7%')).toBeInTheDocument();
  });

  it('shows a friendly retry card when finished goods loading fails in real mode', async () => {
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    server.use(
      http.get('/api/orchestrator/business-finished-goods', () => HttpResponse.json({ detail: 'down' }, { status: 500 })),
    );

    renderPage();

    expect(await screen.findByText('数据加载失败')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument();
    expect(screen.queryByText('成品库汇总')).not.toBeInTheDocument();
  });

  it('releases blocked finished goods through inspection pass', async () => {
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    let inspected: unknown;
    server.use(
      http.get('/api/orchestrator/business-finished-goods', () =>
        HttpResponse.json({
          tenant_id: 'default',
          items: [
            {
              material_id: 'FG-1',
              order_id: 'SO-1',
              material_code: 'FG-1',
              name: 'HDMI 成品',
              unit: 'PCS',
              balance: {
                location_id: 'FG-WH',
                quantity_on_hand: '3',
                quantity_available: '0',
                quantity_blocked: '3',
              },
              produced_total: '3',
              defect_total: '0',
              good_total: '3',
              yield_rate: 1,
              lots: [],
              yield_summary: [],
            },
          ],
        }),
      ),
      http.post('/api/orchestrator/business-facts', async ({ request }) => {
        inspected = await request.json();
        return HttpResponse.json({ fact: { fact_version_id: 'fact-inspect-1' } }, { status: 202 });
      }),
    );

    renderPage();

    const release = await screen.findByRole('button', { name: '检验放行' });
    expect(release).toBeInTheDocument();
    release.click();

    expect(await screen.findByText(/检验合格并转入可用量/)).toBeInTheDocument();
    const modalRoot = document.querySelector('.ant-modal');
    expect(modalRoot).not.toBeNull();
    const footerButtons = modalRoot?.querySelectorAll('.ant-modal-footer button');
    const okButton = footerButtons?.[footerButtons.length - 1];
    expect(okButton).not.toBeNull();
    await userEvent.click(okButton as HTMLElement);

    await waitFor(() => {
      const payload = inspected as Record<string, unknown> | undefined;
      expect(payload?.fact_type).toBe('inspection');
      expect((payload?.payload as Record<string, unknown>)?.result).toBe('pass');
      expect((payload?.payload as Record<string, unknown>)?.quantity).toBe('3');
      expect((payload?.payload as Record<string, unknown>)?.order_id).toBe('SO-1');
    });
  });

  it('scraps failed finished goods through inspection fail', async () => {
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    let inspected: unknown;
    server.use(
      http.get('/api/orchestrator/business-finished-goods', () =>
        HttpResponse.json({
          tenant_id: 'default',
          items: [
            {
              material_id: 'FG-1',
              order_id: 'SO-1',
              material_code: 'FG-1',
              name: 'HDMI 成品',
              unit: 'PCS',
              balance: {
                location_id: 'FG-WH',
                quantity_on_hand: '3',
                quantity_available: '0',
                quantity_blocked: '3',
              },
              produced_total: '3',
              defect_total: '0',
              good_total: '3',
              yield_rate: 1,
              lots: [],
              yield_summary: [],
            },
          ],
        }),
      ),
      http.post('/api/orchestrator/business-facts', async ({ request }) => {
        inspected = await request.json();
        return HttpResponse.json({ fact: { fact_version_id: 'fact-inspect-2' } }, { status: 202 });
      }),
    );

    renderPage();

    const scrap = await screen.findByRole('button', { name: '检验不合格' });
    scrap.click();
    expect(await screen.findByText(/报废销账/)).toBeInTheDocument();
    const qtyInput = screen.getByLabelText('报废数量');
    await userEvent.clear(qtyInput);
    await userEvent.type(qtyInput, '2');

    const modalRoot = document.querySelector('.ant-modal');
    const footerButtons = modalRoot?.querySelectorAll('.ant-modal-footer button');
    await userEvent.click(footerButtons?.[footerButtons.length - 1] as HTMLElement);

    await waitFor(() => {
      const payload = inspected as Record<string, unknown> | undefined;
      expect(payload?.fact_type).toBe('inspection');
      expect((payload?.payload as Record<string, unknown>)?.result).toBe('fail');
      expect((payload?.payload as Record<string, unknown>)?.quantity).toBe('2');
    });
  });
});
