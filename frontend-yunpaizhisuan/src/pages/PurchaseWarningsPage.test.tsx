import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthMe } from '../auth/authApi';
import { useAuthStore } from '../auth/useAuthStore';
import { getAuditLogs } from '../services/auditApi';
import { currentRoleQueryKey } from '../services/permissionApi';
import { server } from '../mocks/server';
import { renderWithApp } from '../tests/testUtils';
import { PurchaseWarningsPage } from './PurchaseWarningsPage';

const authenticatedMe = (overrides: Partial<AuthMe> = {}): AuthMe => ({
  auth_mode: 'shared_anonymous',
  principal_id: 'm4-operator',
  principal_type: 'shared_anonymous',
  user: { name: '采购操作员' },
  tenant: { id: 'tenant-a', name: '测试租户' },
  shared_data: true,
  roles: ['m4-operator'],
  permissions: ['m4:read', 'm4:operate'],
  session: { id: 'session-a', csrf_token: 'test-only', idle_expires_at: 'later', absolute_expires_at: 'later' },
  ...overrides,
});

describe('PurchaseWarningsPage', () => {
  const enableDemoMode = () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubEnv('VITE_ENABLE_MSW', 'true');
  };

  const openAlertsTab = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('tab', { name: '采购预警' }));
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    act(() => {
      useAuthStore.setState({ status: 'idle', config: undefined, me: undefined, error: undefined });
    });
  });

  it('renders loading state before M4 data resolves', () => {
    const { container } = renderWithApp(<PurchaseWarningsPage />);

    expect(container.querySelector('.ant-spin')).toBeInTheDocument();
  });

  it('renders M4 alert data and filters by supplier, status and alert type', async () => {
    const user = userEvent.setup();
    renderWithApp(<PurchaseWarningsPage />);

    await openAlertsTab(user);
    expect((await screen.findAllByText('华东五金供应商')).length).toBeGreaterThan(0);
    expect(screen.getByText('轴承')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: '供应商筛选' }));
    await user.click(await screen.findByTitle('华南电子供应商'));
    expect((await screen.findAllByText('华南电子供应商')).length).toBeGreaterThan(0);
    expect(await screen.findByText('传感器')).toBeInTheDocument();
    expect(screen.queryByText('轴承')).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: '供应商筛选' }));
    await user.click(await screen.findByTitle('全部供应商'));
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '预警状态筛选' }));
    await user.click(await screen.findByTitle('处理中'));
    expect((await screen.findAllByText('华南电子供应商')).length).toBeGreaterThan(0);
    expect(screen.queryByText('轴承')).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: '预警状态筛选' }));
    await user.click(await screen.findByTitle('全部状态'));
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '预警类型筛选' }));
    await user.click(await screen.findByTitle('供应商异常'));
    expect((await screen.findAllByText('西南机加供应商')).length).toBeGreaterThan(0);
    expect(screen.queryByText('传感器')).not.toBeInTheDocument();
  }, 10_000);

  it('opens alert and tracking detail drawers', async () => {
    const user = userEvent.setup();
    renderWithApp(<PurchaseWarningsPage />);

    await openAlertsTab(user);
    await screen.findByText('轴承');
    await user.click(screen.getAllByRole('button', { name: /查看预警/ })[0] as HTMLElement);
    expect(await screen.findByText('预警详情')).toBeInTheDocument();
    expect(screen.getByText('催单文本')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('tab', { name: '采购追踪' }));
    await screen.findAllByText('追踪 ID');
    await user.click(screen.getAllByRole('button', { name: /查看追踪/ })[0] as HTMLElement);
    expect(await screen.findByText('追踪详情')).toBeInTheDocument();
    expect(screen.getAllByText('采购单项').length).toBeGreaterThan(0);
  });

  it('generates urge messages, marks follow-up and writes M4 audit logs', async () => {
    enableDemoMode();
    const user = userEvent.setup();
    renderWithApp(<PurchaseWarningsPage />);

    await openAlertsTab(user);
    await screen.findByText('轴承');
    await user.click(screen.getAllByRole('button', { name: /生成催单/ })[0] as HTMLElement);
    expect(await screen.findByText('催单文本已生成')).toBeInTheDocument();

    await waitFor(async () => {
      await expect(getAuditLogs()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'M4_ALERT_URGE_MESSAGE',
            module: 'M4',
            targetId: '501',
            result: 'success',
          }),
        ]),
      );
    });

    await user.click(screen.getAllByRole('button', { name: /标记跟进/ })[0] as HTMLElement);
    expect(await screen.findByText('已标记跟进')).toBeInTheDocument();
    await waitFor(async () => {
      await expect(getAuditLogs()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'M4_ALERT_FOLLOW_UP',
            targetId: '501',
          }),
        ]),
      );
    });
  });

  it('does not roll back the main operation when audit log sync fails', async () => {
    enableDemoMode();
    const user = userEvent.setup();
    server.use(http.post('/api/audit/logs', () => HttpResponse.json({ message: 'audit down' }, { status: 500 })));

    renderWithApp(<PurchaseWarningsPage />);

    await openAlertsTab(user);
    await screen.findByText('轴承');
    await user.click(screen.getAllByRole('button', { name: /标记跟进/ })[0] as HTMLElement);

    expect(await screen.findByText('已标记跟进')).toBeInTheDocument();
    expect(await screen.findByText('日志同步失败')).toBeInTheDocument();
  });

  it('blocks the page when the role lacks m4:read', async () => {
    window.localStorage.setItem('mockRoleId', 'worker');

    renderWithApp(<PurchaseWarningsPage />);

    expect(await screen.findByText('无权限访问')).toBeInTheDocument();
    expect(screen.getByText('缺少权限：m4:read')).toBeInTheDocument();
  });

  it('disables M4 writes when the authenticated identity is downgraded to read-only', async () => {
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    vi.stubEnv('VITE_ENABLE_DEMO_ROLES', 'false');
    useAuthStore.setState({ status: 'ready', me: authenticatedMe(), error: undefined });
    const { queryClient } = renderWithApp(<PurchaseWarningsPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: /扫描预警/ })).not.toBeDisabled());
    await act(async () => {
      queryClient.setQueryData(
        [...currentRoleQueryKey, 'm4-reader', 'tenant-a', 'session-b', ['m4-reader'], ['m4:read']],
        { id: 'm4-reader', name: '采购只读用户', permissions: ['m4:read'] },
      );
      useAuthStore.setState({
        me: authenticatedMe({
          principal_id: 'm4-reader',
          user: { name: '采购只读用户' },
          roles: ['m4-reader'],
          permissions: ['m4:read'],
          session: { id: 'session-b', csrf_token: 'test-only-b', idle_expires_at: 'later', absolute_expires_at: 'later' },
        }),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => expect(screen.getByRole('button', { name: /扫描预警/ })).toBeDisabled());
  });

  it('updates alert status in real API mode', async () => {
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    const user = userEvent.setup();

    renderWithApp(<PurchaseWarningsPage />);

    await openAlertsTab(user);
    await screen.findByText('轴承');
    expect(screen.getAllByRole('button', { name: /生成催单/ })[0]).not.toBeDisabled();
    expect(screen.getAllByRole('button', { name: /标记跟进/ })[0]).not.toBeDisabled();
    await user.click(screen.getAllByRole('button', { name: /标记跟进/ })[0] as HTMLElement);
    expect(await screen.findByText('已标记跟进')).toBeInTheDocument();
  });

  it('shows AI parse results and confirms low-confidence replies manually', async () => {
    const user = userEvent.setup();
    renderWithApp(<PurchaseWarningsPage />);

    await user.click(await screen.findByRole('tab', { name: 'AI 解析' }));
    expect((await screen.findAllByText('PO-20260703-002')).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /解析供应商回复/ }));

    expect(await screen.findByText('AI 解析完成')).toBeInTheDocument();
    expect(screen.getByText('62%')).toBeInTheDocument();
    expect(screen.getByText('需要人工确认')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /人工确认/ }));

    expect(await screen.findByText('AI 解析已人工确认')).toBeInTheDocument();
    expect(screen.getByText('已确认')).toBeInTheDocument();
  });

  it('renders empty state when M4 alerts are empty', async () => {
    server.use(http.get('/api/m4/alerts', () => HttpResponse.json({ items: [], page: 1, page_size: 20, total: 0 })));
    const user = userEvent.setup();

    renderWithApp(<PurchaseWarningsPage />);

    await openAlertsTab(user);
    expect((await screen.findAllByText('暂无数据')).length).toBeGreaterThan(0);
  });

  it('renders an overdue day color bar for every alert row', async () => {
    const user = userEvent.setup();
    renderWithApp(<PurchaseWarningsPage />);

    await openAlertsTab(user);
    await screen.findByText('轴承');

    expect(screen.getAllByTestId('overdue-bar').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('4 天')).toBeInTheDocument();
  });

  it('selects valid suggestions and generates purchase orders', async () => {
    let receivedTaskId: string | null = null;
    server.use(
      http.get('/api/m4/import-batches/:id', () =>
        HttpResponse.json({
          id: 1,
          filename: 'tracked.json',
          total_rows: 2,
          valid_rows: 2,
          invalid_rows: 0,
          duplicate_rows: 0,
          status: 'completed',
          items: [],
          tracking_task_id: 'TASK-M4-UI-1',
        }),
      ),
      http.post('/api/m4/purchase-orders/generate', async ({ request }) => {
        receivedTaskId = request.headers.get('X-Yunpai-Task-ID');
        return HttpResponse.json([
          {
            id: 901,
            purchase_order_no: 'PO-M4-UI-1',
            source_import_batch_id: 1,
            tracking_task_id: receivedTaskId,
            supplier_name: '华东五金供应商',
            status: 'draft',
            items: [],
          },
        ]);
      }),
    );
    const user = userEvent.setup();
    renderWithApp(<PurchaseWarningsPage />);

    await user.click(await screen.findByRole('tab', { name: '采购建议' }));
    expect(await screen.findByText('重复采购建议')).toBeInTheDocument();
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.at(-1)).toBeDisabled();

    await user.click(checkboxes[1] as HTMLElement);
    await user.click(screen.getByRole('button', { name: /生成采购单/ }));

    expect(await screen.findByText('已生成 1 张采购单')).toBeInTheDocument();
    expect(receivedTaskId).toBe('TASK-M4-UI-1');
  });

  it('uploads a purchase suggestion CSV', async () => {
    const user = userEvent.setup();
    const { container } = renderWithApp(<PurchaseWarningsPage />);

    await user.click(await screen.findByRole('tab', { name: '采购建议' }));
    await screen.findByText('重复采购建议');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 1,
          filename: 'm4-suggestions.csv',
          total_rows: 3,
          valid_rows: 2,
          invalid_rows: 0,
          duplicate_rows: 1,
          status: 'completed',
          created_at: '2026-07-15T10:00:00',
          items: [],
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    await user.upload(
      fileInput as HTMLInputElement,
      new File(['item_code,item_name,quantity\nMAT-001,轴承,100'], 'm4-suggestions.csv', { type: 'text/csv' }),
    );
    await user.click(screen.getByRole('button', { name: /导入采购建议/ }));

    expect(await screen.findByText('采购建议已导入，有效 2 条')).toBeInTheDocument();
  });

  it('moves a draft purchase order through review into pending send', async () => {
    const user = userEvent.setup();
    let status = 'draft';
    const order = {
      id: 901,
      purchase_order_no: 'PO-M4-FLOW-001',
      supplier_name: '流程测试供应商',
      required_date: '2026-07-30',
      items: [
        {
          id: 902,
          item_code: 'MAT-FLOW',
          item_name: '流程测试物料',
          quantity: '10',
          unit: 'pcs',
          status: 'pending',
        },
      ],
    };
    server.use(
      http.get('/api/m4/purchase-orders', () =>
        HttpResponse.json({ items: [{ ...order, status }], page: 1, page_size: 20, total: 1 }),
      ),
      http.post('/api/m4/purchase-orders/:id/submit-review', () => {
        status = 'pending_review';
        return HttpResponse.json({ ...order, status });
      }),
      http.post('/api/m4/purchase-orders/:id/approve', () => {
        status = 'pending_send';
        return HttpResponse.json({ ...order, status });
      }),
    );

    renderWithApp(<PurchaseWarningsPage />);
    await user.click(await screen.findByRole('tab', { name: '采购单' }));

    await user.click(await screen.findByRole('button', { name: /提交审核/ }));
    expect(await screen.findByText('采购单已提交审核')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /批准/ }));
    expect(await screen.findByText('采购单审核通过')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /生成询价/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /发送供应商/ })).toBeInTheDocument();
  });

  it('scans alerts and closes a processing alert', async () => {
    const user = userEvent.setup();
    renderWithApp(<PurchaseWarningsPage />);

    await openAlertsTab(user);
    await screen.findByText('轴承');
    await user.click(screen.getByRole('button', { name: /扫描预警/ }));
    expect(await screen.findByText('预警扫描完成，新增 1 条')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /关闭预警/ }));
    expect(await screen.findByText('预警已关闭')).toBeInTheDocument();
  });

  it('excludes draft purchase orders from AI reply parsing', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/m4/purchase-orders', ({ request }) =>
        HttpResponse.json({
          items: [
            {
              id: 911,
              purchase_order_no: 'PO-DRAFT-NOT-PARSEABLE',
              supplier_name: '草稿供应商',
              status: 'draft',
              required_date: '2026-07-30',
              items: [
                {
                  id: 912,
                  item_code: 'MAT-DRAFT',
                  item_name: '草稿物料',
                  quantity: '5',
                  unit: 'pcs',
                  status: 'pending',
                },
              ],
            },
          ],
          page: 1,
          page_size: Number(new URL(request.url).searchParams.get('page_size') ?? 20),
          total: 1,
        }),
      ),
    );

    renderWithApp(<PurchaseWarningsPage />);
    await user.click(await screen.findByRole('tab', { name: 'AI 解析' }));

    expect(await screen.findByText('暂无数据')).toBeInTheDocument();
    expect(screen.queryByText('PO-DRAFT-NOT-PARSEABLE')).not.toBeInTheDocument();
  });

  it('requests tracking with a page size of 10 instead of 2', async () => {
    const user = userEvent.setup();
    let requestedPageSize: string | null = null;
    server.use(
      http.get('/api/m4/tracking', ({ request }) => {
        requestedPageSize = new URL(request.url).searchParams.get('page_size');
        return HttpResponse.json({ items: [], page: 1, page_size: 10, total: 0 });
      }),
    );

    renderWithApp(<PurchaseWarningsPage />);
    await user.click(await screen.findByRole('tab', { name: '采购追踪' }));

    await waitFor(() => expect(requestedPageSize).toBe('10'));
  });

  it('paginates alerts through the server using page params', async () => {
    const user = userEvent.setup();
    const requestedPages: string[] = [];
    const items = Array.from({ length: 12 }, (_, index) => ({
      id: 600 + index,
      alert_type: 'overdue',
      purchase_order_no: `PO-PAGE-${index}`,
      supplier_name: `分页供应商${index}`,
      item_code: `MAT-P-${index}`,
      item_name: `分页物料${index}`,
      promised_date: '2026-07-01',
      days_overdue: index,
      status: 'open',
    }));
    server.use(
      http.get('/api/m4/alerts', ({ request }) => {
        const url = new URL(request.url);
        const page = Number(url.searchParams.get('page') ?? 1);
        const pageSize = Number(url.searchParams.get('page_size') ?? 10);
        requestedPages.push(String(page));
        const sliced = items.slice((page - 1) * pageSize, page * pageSize);
        return HttpResponse.json({ items: sliced, page, page_size: pageSize, total: items.length });
      }),
    );

    renderWithApp(<PurchaseWarningsPage />);
    await openAlertsTab(user);

    expect(await screen.findByText('分页物料0')).toBeInTheDocument();
    expect(requestedPages[0]).toBe('1');
    expect(screen.getAllByText(/分页物料/).length).toBe(10);

    await user.click(screen.getByTitle('2'));
    expect(await screen.findByText('分页物料10')).toBeInTheDocument();
    expect(screen.getAllByText(/分页物料/).length).toBe(2);
    expect(requestedPages[requestedPages.length - 1]).toBe('2');
  });
});
