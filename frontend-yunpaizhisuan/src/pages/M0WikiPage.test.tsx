import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../mocks/server';
import { renderWithApp } from '../tests/testUtils';
import { M0WikiPage } from './M0WikiPage';

const envelope = (data: unknown) => ({ success: true, data, errors: [] });

const searchInputPlaceholder = '按编码、名称或语义搜索规范库（如 V-H301W / HDMI 线材）';

const canonicalEntityTypes = [
  ['product', '产品'],
  ['product_family', '产品族'],
  ['order', '订单'],
  ['bom', 'BOM'],
  ['document', '文档'],
  ['material', '物料'],
  ['supplier', '供应商'],
  ['equipment', '设备'],
  ['process_route', '工艺路线'],
  ['operation', '工序'],
  ['tooling', '工装'],
] as const;

describe('M0WikiPage', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/m0/wiki/entities/:entityType/:businessKey', ({ params }) =>
        HttpResponse.json(
          envelope({
            entity: {
              entity_id: `${params.entityType}-${params.businessKey}`,
              version_row_id: `version-${params.entityType}-${params.businessKey}`,
              entity_type: params.entityType,
              business_key: params.businessKey,
              label: `测试${params.entityType}`,
              status: 'active',
              attributes: {},
            },
            history: [],
            lines: [],
            summary: { sources: 0, relations: 0 },
          }),
        ),
      ),
    );
  });

  it('只在提交完整物料编码后执行精确反查', async () => {
    const user = userEvent.setup();
    const requestedCodes: string[] = [];
    server.use(
      http.get('/api/m0/wiki/materials/:code', ({ params }) => {
        requestedCodes.push(String(params.code));
        return HttpResponse.json(
          envelope({
            material: { business_key: params.code, label: '测试物料' },
            summary: { boms: 1, products: 1 },
            history: [],
          }),
        );
      }),
    );

    renderWithApp(<M0WikiPage />);

    const input = screen.getByPlaceholderText('物料编码');
    await user.type(input, 'YA.C.01.0545012');
    expect(requestedCodes).toEqual([]);

    await user.keyboard('{Enter}');

    expect(await screen.findByText('YA.C.01.0545012 反查')).toBeInTheDocument();
    expect(requestedCodes).toEqual(['YA.C.01.0545012']);
  });

  it('物料和设备 404 显示未找到而不是加载失败', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/m0/wiki/materials/:code', () =>
        HttpResponse.json({ detail: { code: 'MATERIAL_NOT_FOUND', message: 'material not found' } }, { status: 404 }),
      ),
      http.get('/api/m0/wiki/equipment/:code', () =>
        HttpResponse.json({ detail: { code: 'EQUIPMENT_NOT_FOUND', message: 'equipment not found' } }, { status: 404 }),
      ),
    );

    renderWithApp(<M0WikiPage />);

    await user.type(screen.getByPlaceholderText('物料编码'), 'UNKNOWN-MAT{Enter}');
    expect(await screen.findByText('未找到该物料：UNKNOWN-MAT')).toBeInTheDocument();
    expect(screen.queryByText(/物料加载失败/)).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('设备编码'), 'UNKNOWN-EQ{Enter}');
    expect(await screen.findByText('未找到该设备：UNKNOWN-EQ')).toBeInTheDocument();
    expect(screen.queryByText(/设备加载失败/)).not.toBeInTheDocument();
  });

  it('可从全局搜索结果选择物料和设备', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/m0/search', () =>
        HttpResponse.json(
          envelope({
            results: [
              { entity_id: 'mat-1', entity_type: 'material', business_key: 'MAT-SEARCH' },
              { entity_id: 'eq-1', entity_type: 'equipment', business_key: 'EQ-SEARCH' },
            ],
          }),
        ),
      ),
      http.get('/api/m0/wiki/materials/MAT-SEARCH', () =>
        HttpResponse.json(
          envelope({ material: { business_key: 'MAT-SEARCH' }, summary: { products: 2 }, history: [] }),
        ),
      ),
      http.get('/api/m0/wiki/equipment/EQ-SEARCH', () =>
        HttpResponse.json(
          envelope({ entity: { business_key: 'EQ-SEARCH' }, summary: { products: 3 }, history: [] }),
        ),
      ),
    );

    renderWithApp(<M0WikiPage />);

    await user.type(
      screen.getByPlaceholderText('按编码、名称或语义搜索规范库（如 V-H301W / HDMI 线材）'),
      'SEARCH{Enter}',
    );
    await user.click(await screen.findByText('[material] MAT-SEARCH'));
    expect(await screen.findByText('MAT-SEARCH 反查')).toBeInTheDocument();

    await user.click(screen.getByText('[equipment] EQ-SEARCH'));
    expect(await screen.findByText('EQ-SEARCH 反查')).toBeInTheDocument();
  });

  it('零结果搜索会清除上一次的结果和详情', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/m0/search', async ({ request }) => {
        const body = (await request.json()) as { query: string };
        return HttpResponse.json(envelope({
          results: body.query === 'HAS-RESULT'
            ? [{ entity_id: 'order-old', entity_type: 'order', business_key: 'ORDER-OLD' }]
            : [],
        }));
      }),
    );

    renderWithApp(<M0WikiPage />);
    const input = screen.getByPlaceholderText(searchInputPlaceholder);

    await user.type(input, 'HAS-RESULT{Enter}');
    expect(await screen.findByText('订单 · ORDER-OLD')).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, 'NO-RESULT{Enter}');

    expect(await screen.findByText('未找到匹配的 Wiki 数据')).toBeInTheDocument();
    expect(screen.queryByText('订单 · ORDER-OLD')).not.toBeInTheDocument();
    expect(screen.queryByText('[order] ORDER-OLD')).not.toBeInTheDocument();
  });

  it('搜索失败会清除旧结果和旧详情', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/m0/search', async ({ request }) => {
        const body = (await request.json()) as { query: string };
        if (body.query === 'FAIL') {
          return HttpResponse.json({ detail: { code: 'SEARCH_FAILED', message: 'search unavailable' } }, { status: 503 });
        }
        return HttpResponse.json(envelope({
          results: [{ entity_id: 'supplier-old', entity_type: 'supplier', business_key: 'SUP-OLD' }],
        }));
      }),
    );

    renderWithApp(<M0WikiPage />);
    const input = screen.getByPlaceholderText(searchInputPlaceholder);

    await user.type(input, 'OK{Enter}');
    expect(await screen.findByText('供应商 · SUP-OLD')).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, 'FAIL{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('search unavailable');
    expect(screen.queryByText('供应商 · SUP-OLD')).not.toBeInTheDocument();
    expect(screen.queryByText('[supplier] SUP-OLD')).not.toBeInTheDocument();
  });

  it('忽略较早搜索的迟到响应', async () => {
    const user = userEvent.setup();
    let releaseSlowSearch: (() => void) | undefined;
    const slowSearch = new Promise<void>((resolve) => {
      releaseSlowSearch = resolve;
    });
    server.use(
      http.post('/api/m0/search', async ({ request }) => {
        const body = (await request.json()) as { query: string };
        if (body.query === 'SLOW') {
          await slowSearch;
          return HttpResponse.json(envelope({
            results: [{ entity_id: 'order-slow', entity_type: 'order', business_key: 'ORDER-SLOW' }],
          }));
        }
        return HttpResponse.json(envelope({
          results: [{ entity_id: 'order-fast', entity_type: 'order', business_key: 'ORDER-FAST' }],
        }));
      }),
    );

    renderWithApp(<M0WikiPage />);
    const input = screen.getByPlaceholderText(searchInputPlaceholder);

    await user.type(input, 'SLOW{Enter}');
    await user.clear(input);
    await user.type(input, 'FAST{Enter}');
    expect(await screen.findByText('订单 · ORDER-FAST')).toBeInTheDocument();

    await act(async () => {
      releaseSlowSearch?.();
      await slowSearch;
    });

    expect(screen.getByText('订单 · ORDER-FAST')).toBeInTheDocument();
    expect(screen.queryByText('订单 · ORDER-SLOW')).not.toBeInTheDocument();
    expect(screen.queryByText('[order] ORDER-SLOW')).not.toBeInTheDocument();
  });

  it('搜索结果是可聚焦并可用键盘选择的控件', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/m0/search', () => HttpResponse.json(envelope({
        results: [
          { entity_id: 'order-keyboard', entity_type: 'order', business_key: 'ORDER-KEYBOARD' },
          { entity_id: 'supplier-keyboard', entity_type: 'supplier', business_key: 'SUP-KEYBOARD' },
        ],
      }))),
    );

    renderWithApp(<M0WikiPage />);
    await user.type(screen.getByPlaceholderText(searchInputPlaceholder), 'KEYBOARD{Enter}');

    const supplierResult = await screen.findByRole('button', { name: '[supplier] SUP-KEYBOARD' });
    act(() => supplierResult.focus());
    await user.keyboard('{Enter}');

    expect(await screen.findByText('供应商 · SUP-KEYBOARD')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '[supplier] SUP-KEYBOARD' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('11 类规范实体都可以从搜索结果打开详情', async () => {
    const user = userEvent.setup();
    const results = canonicalEntityTypes.map(([entityType]) => ({
      entity_id: `${entityType}-matrix`,
      entity_type: entityType,
      business_key: `${entityType.toUpperCase()}-MATRIX`,
    }));
    server.use(
      http.post('/api/m0/search', () => HttpResponse.json(envelope({ results }))),
      http.get('/api/m0/wiki/products/PRODUCT-MATRIX', () => HttpResponse.json(envelope({
        product: { entity_type: 'product', business_key: 'PRODUCT-MATRIX', label: '测试产品' },
        indexes: {},
        families: [],
        same_family_products: [],
        routes: [],
        graph: { nodes: [], edges: [] },
        history: [],
        summary: {},
      }))),
      http.get('/api/m0/wiki/materials/MATERIAL-MATRIX', () => HttpResponse.json(envelope({
        material: { entity_type: 'material', business_key: 'MATERIAL-MATRIX' },
        summary: {},
        history: [],
      }))),
      http.get('/api/m0/wiki/equipment/EQUIPMENT-MATRIX', () => HttpResponse.json(envelope({
        entity: { entity_type: 'equipment', business_key: 'EQUIPMENT-MATRIX' },
        summary: {},
        history: [],
      }))),
    );

    renderWithApp(<M0WikiPage />);
    await user.type(screen.getByPlaceholderText(searchInputPlaceholder), 'MATRIX{Enter}');

    for (const [entityType, entityLabel] of canonicalEntityTypes) {
      const businessKey = `${entityType.toUpperCase()}-MATRIX`;
      await user.click(await screen.findByRole('button', { name: `[${entityType}] ${businessKey}` }));
      expect(await screen.findByText(`${entityLabel} · ${businessKey}`)).toBeInTheDocument();
    }
  });

  it('可打开订单搜索结果并展示订单详情', async () => {
    const user = userEvent.setup();
    const requestedEntities: string[] = [];
    server.use(
      http.post('/api/m0/search', () =>
        HttpResponse.json(
          envelope({
            results: [
              { entity_id: 'order-1', entity_type: 'order', business_key: 'SO-HIST-20260724-005' },
            ],
          }),
        ),
      ),
      http.get('/api/m0/wiki/entities/:entityType/:businessKey', ({ params }) => {
        requestedEntities.push(`${params.entityType}:${params.businessKey}`);
        return HttpResponse.json(
          envelope({
            entity: {
              entity_id: 'order-1',
              version_row_id: 'order-version-1',
              entity_type: params.entityType,
              business_key: params.businessKey,
              label: '历史订单 005',
              status: 'active',
              attributes: { customer: '测试客户' },
            },
            history: [],
            lines: [{ line_no: '10', product_code: 'HDMI19+1', quantity: 100 }],
            summary: { sources: 1, relations: 1 },
          }),
        );
      }),
    );

    renderWithApp(<M0WikiPage />);

    await user.type(
      screen.getByPlaceholderText('按编码、名称或语义搜索规范库（如 V-H301W / HDMI 线材）'),
      'SO-HIST-20260724-005{Enter}',
    );
    await user.click(await screen.findByText('[order] SO-HIST-20260724-005'));

    expect(await screen.findByText('订单 · SO-HIST-20260724-005')).toBeInTheDocument();
    expect(screen.getByText('历史订单 005')).toBeInTheDocument();
    expect(requestedEntities).toContain('order:SO-HIST-20260724-005');
  });

  it('供应商停用后禁用重复删除', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/m0/search', () =>
        HttpResponse.json(
          envelope({
            results: [
              { entity_id: 'supplier-1', entity_type: 'supplier', business_key: 'SUP-INACTIVE' },
            ],
          }),
        ),
      ),
      http.get('/api/m0/wiki/entities/supplier/SUP-INACTIVE', () =>
        HttpResponse.json(
          envelope({
            entity: {
              entity_id: 'supplier-1',
              version_row_id: 'supplier-version-1',
              entity_type: 'supplier',
              business_key: 'SUP-INACTIVE',
              label: '停用供应商',
              status: 'inactive',
              attributes: {},
            },
            history: [],
            lines: [],
            summary: { sources: 1, relations: 0 },
          }),
        ),
      ),
    );

    renderWithApp(<M0WikiPage />);
    await user.type(
      screen.getByPlaceholderText('按编码、名称或语义搜索规范库（如 V-H301W / HDMI 线材）'),
      'SUP-INACTIVE{Enter}',
    );

    expect(await screen.findByText('供应商 · SUP-INACTIVE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /删除/ })).toBeDisabled();
  });

  it('通过页面完成新增、查询刷新、编辑和逻辑删除', async () => {
    const user = userEvent.setup();
    let currentEntity = {
      entity_id: 'product-crud-1',
      version_row_id: 'version-crud-1',
      entity_type: 'product',
      business_key: 'WIKI-CRUD-001',
      label: 'Wiki CRUD 产品',
      status: 'active',
      attributes: { name: 'Wiki CRUD 产品', model: 'CRUD-1', status: 'active' },
      reviewed_by: 'test-reviewer',
    };
    let history = [{ status: 'active', recorded_from: '2026-08-19T00:00:00Z' }];
    const mutations: Array<{ method: string; body: Record<string, unknown>; taskId: string }> = [];

    server.use(
      http.get('/api/m0/wiki/entities/product/WIKI-CRUD-001', () =>
        HttpResponse.json(envelope({
          entity: currentEntity,
          history,
          lines: [],
          summary: { history_versions: history.length, sources: 1, relations: 0 },
        })),
      ),
      http.get('/api/m0/wiki/products/WIKI-CRUD-001', () =>
        HttpResponse.json(envelope({
          product: currentEntity,
          indexes: {},
          families: [],
          same_family_products: [],
          routes: [],
          graph: { nodes: [], edges: [] },
          history,
          summary: {},
        })),
      ),
      http.post('/api/m0/wiki/entities', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        mutations.push({ method: 'POST', body, taskId: request.headers.get('X-Yunpai-Task-ID') ?? '' });
        expect(body).toMatchObject({
          entity_type: 'product',
          business_key: 'WIKI-CRUD-001',
          payload: { name: 'Wiki CRUD 产品', model: 'CRUD-1', status: 'active' },
          expected_version_row_id: '',
          reason: '新增 Wiki CRUD 验收数据',
        });
        return HttpResponse.json(envelope({ action: 'create', entity: currentEntity, publication: { published: 1 } }), { status: 201 });
      }),
      http.patch('/api/m0/wiki/entities/product/WIKI-CRUD-001', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        mutations.push({ method: 'PATCH', body, taskId: request.headers.get('X-Yunpai-Task-ID') ?? '' });
        expect(body).toMatchObject({
          entity_type: 'product',
          business_key: 'WIKI-CRUD-001',
          payload: { name: 'Wiki CRUD 产品（已更新）', model: 'CRUD-2', status: 'active' },
          expected_version_row_id: 'version-crud-1',
          reason: '更新产品名称与型号',
        });
        currentEntity = {
          ...currentEntity,
          version_row_id: 'version-crud-2',
          label: 'Wiki CRUD 产品（已更新）',
          attributes: { name: 'Wiki CRUD 产品（已更新）', model: 'CRUD-2', status: 'active' },
        };
        history = [...history, { status: 'active', recorded_from: '2026-08-19T01:00:00Z' }];
        return HttpResponse.json(envelope({ action: 'update', entity: currentEntity, publication: { published: 1 } }));
      }),
      http.delete('/api/m0/wiki/entities/product/WIKI-CRUD-001', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        mutations.push({ method: 'DELETE', body, taskId: request.headers.get('X-Yunpai-Task-ID') ?? '' });
        expect(body).toMatchObject({
          expected_version_row_id: 'version-crud-2',
          reason: '完成 Wiki CRUD 验收后逻辑停用',
        });
        currentEntity = {
          ...currentEntity,
          version_row_id: 'version-crud-3',
          status: 'deprecated',
          attributes: { ...currentEntity.attributes, status: 'deprecated' },
        };
        history = [...history, { status: 'deprecated', recorded_from: '2026-08-19T02:00:00Z' }];
        return HttpResponse.json(envelope({ action: 'delete', entity: currentEntity, publication: { published: 1 } }));
      }),
    );

    renderWithApp(<M0WikiPage />);

    await user.click(screen.getByRole('button', { name: /新增/ }));
    let dialog = screen.getByRole('dialog', { name: '新增 Wiki 数据' });
    await user.type(within(dialog).getByLabelText('业务编码'), 'WIKI-CRUD-001');
    fireEvent.change(within(dialog).getByLabelText('业务数据（JSON）'), {
      target: { value: JSON.stringify({ name: 'Wiki CRUD 产品', model: 'CRUD-1', status: 'active' }) },
    });
    await user.type(within(dialog).getByLabelText('变更说明'), '新增 Wiki CRUD 验收数据');
    await user.click(within(dialog).getByRole('button', { name: /新\s*增/ }));

    expect(await screen.findByText('产品 · WIKI-CRUD-001')).toBeInTheDocument();
    expect(screen.getAllByText('Wiki CRUD 产品').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /编辑/ }));
    dialog = screen.getByRole('dialog', { name: '编辑 Wiki 数据' });
    expect(within(dialog).getByRole('button', { name: /保\s*存/ })).not.toHaveClass('ant-btn-loading');
    expect(within(dialog).getByLabelText('业务编码')).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('业务数据（JSON）'), {
      target: { value: JSON.stringify({ name: 'Wiki CRUD 产品（已更新）', model: 'CRUD-2', status: 'active' }) },
    });
    await user.type(within(dialog).getByLabelText('变更说明'), '更新产品名称与型号');
    await user.click(within(dialog).getByRole('button', { name: /保\s*存/ }));

    expect((await screen.findAllByText('Wiki CRUD 产品（已更新）')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('历史（2）').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /删除/ }));
    const deleteDialog = screen.getByLabelText('删除原因').closest('[role="dialog"]');
    expect(deleteDialog).not.toBeNull();
    dialog = deleteDialog as HTMLElement;
    expect(within(dialog).getByRole('button', { name: /删\s*除/ })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('删除原因'), '完成 Wiki CRUD 验收后逻辑停用');
    await user.click(within(dialog).getByRole('button', { name: /删\s*除/ }));

    expect((await screen.findAllByText('历史（3）')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /删除/ })).toBeDisabled();
    expect(mutations.map((item) => item.method)).toEqual(['POST', 'PATCH', 'DELETE']);
    expect(mutations.every((item) => item.taskId.startsWith('task_'))).toBe(true);
    expect(mutations.every((item) => String(item.body.mutation_id).startsWith('wiki_'))).toBe(true);
  });
});
