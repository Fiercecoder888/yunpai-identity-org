import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithApp } from '../../tests/testUtils';
import { useAuthStore } from '../../auth/useAuthStore';
import { DataFlowPanel } from './DataFlowPanel';
import { useBusinessRunStore } from './useBusinessRunStore';
import styles from './DataFlowPanel.module.css';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const catalog = [
  { catalog_id: 'hist-catalog-008', order_id: 'SO-HIST-20260724-008', product_name: 'HDMI 8', status: '已核对', task_id: 'task-1' },
];

const manifest = [
  { catalog_id: 'hist-catalog-008', title: 'HDMI 8', order: { order_id: 'SO-HIST-20260724-008' } },
];

const trace = {
  tenant_id: 'tenant',
  order_id: 'SO-HIST-20260724-008',
  order: { order_id: 'SO-HIST-20260724-008', product_name: 'HDMI 8', order_qty: 100, due_date: '2026-09-01' },
  materials: [],
  order_materials: [{ material_id: 'MAT-1' }],
  inventory_balances: [],
  inventory_movements: [],
  procurement_plans: [],
  procurement_plan_lines: [{ line_id: 'L1' }],
  purchase_orders: [],
  schedule_versions: [{ schedule_id: 'cp-demo' }],
  business_flow_runs: [],
  fact_versions: [],
  calculation_runs: [],
  validation_results: [],
  supply_allocations: [],
  recalculation_jobs: [],
};

const useAuthenticatedPermissions = (permissions: string[]) => {
  vi.stubEnv('VITE_ENABLE_MSW', 'false');
  vi.stubEnv('VITE_ENABLE_DEMO_ROLES', 'false');
  vi.stubEnv('VITE_API_BASE_URL', '/api');
  useAuthStore.setState({
    status: 'ready',
    me: {
      auth_mode: 'shared_anonymous',
      principal_id: 'business-flow-test-user',
      principal_type: 'shared_anonymous',
      user: { name: '业务流程测试用户' },
      tenant: { id: 'tenant', name: 'Shared' },
      shared_data: true,
      roles: ['business-flow-test-role'],
      permissions,
      session: {
        id: 'session',
        csrf_token: 'test-only',
        idle_expires_at: 'later',
        absolute_expires_at: 'later',
      },
    },
    error: undefined,
  });
};

describe('DataFlowPanel 大屏数据流', () => {
  beforeEach(() => {
    useAuthenticatedPermissions(['m0:bom:approve', 'm4:operate', 'schedule:write']);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/historical-order-catalog.json')) return jsonResponse(catalog);
      if (url.includes('/run-config/candidate-run-manifest.json')) return jsonResponse(manifest);
      if (url.includes('/orchestrator/business-orders/')) return jsonResponse(trace);
      return jsonResponse({ items: [] });
    }));
    useBusinessRunStore.getState().reset();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    act(() => {
      useAuthStore.setState({ status: 'idle', config: undefined, me: undefined, error: undefined });
    });
  });

  it('展示订单选择、订单到排程 大屏阶段与空态提示', async () => {
    const user = userEvent.setup();
    renderWithApp(<DataFlowPanel />);

    expect(await screen.findByRole('combobox', { name: '选择业务订单' })).toBeInTheDocument();
    const expandButton = screen.getByRole('button', { name: '展开订单流程大屏' });
    expect(expandButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('订单到排程 数据流动')).not.toBeInTheDocument();

    await user.click(expandButton);

    expect(screen.getByRole('button', { name: '收起订单流程大屏' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('data-flow-overlay')).toBeInTheDocument();
    expect(screen.getByLabelText('订单到排程 数据流动')).toBeInTheDocument();
    for (const title of ['订单输入', 'BOM 匹配', '物料计算', '采购入库', '生产排程']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.getByText(/实时展示 订单到排程 数据流动/)).toBeInTheDocument();
  });

  it('点击 Agent 流程卡片会打开对应任务抽屉', async () => {
    const user = userEvent.setup();
    const opened = vi.fn();
    const listener = (event: Event) => opened((event as CustomEvent).detail);
    window.addEventListener('yunpai:open-agent-tasks', listener);
    renderWithApp(<DataFlowPanel />);

    await screen.findByRole('combobox', { name: '选择业务订单' });
    await user.click(screen.getByRole('button', { name: '展开订单流程大屏' }));
    await user.click(screen.getByRole('button', { name: '查看 M1 Agent 任务' }));

    expect(opened).toHaveBeenCalledWith('m1');
    window.removeEventListener('yunpai:open-agent-tasks', listener);
  });

  it('点击查看在本页预览订单链路与关键数据', async () => {
    const user = userEvent.setup();
    renderWithApp(<DataFlowPanel />);

    await screen.findByRole('combobox', { name: '选择业务订单' });
    await user.click(screen.getByRole('button', { name: /查看/ }));

    await waitFor(() => expect(screen.getByText('订单链路预览')).toBeInTheDocument());
    expect(screen.getByText('1 种物料')).toBeInTheDocument();
    expect(screen.getByText('1 条采购建议')).toBeInTheDocument();
    expect(screen.getByText('排程 cp-demo')).toBeInTheDocument();
  });

  it('忽略 superseded 物料：大屏物料数与阶段证据以在用物料为准', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/historical-order-catalog.json')) return jsonResponse(catalog);
      if (url.includes('/run-config/candidate-run-manifest.json')) return jsonResponse(manifest);
      if (url.includes('/orchestrator/business-orders/')) {
        return jsonResponse({
          ...trace,
          order_materials: [
            { material_id: 'MAT-ACTIVE-1', lifecycle_status: 'active' },
            { material_id: 'MAT-OBSOLETE-1', lifecycle_status: 'superseded' },
          ],
        });
      }
      return jsonResponse({ items: [] });
    }));
    renderWithApp(<DataFlowPanel />);

    await screen.findByRole('combobox', { name: '选择业务订单' });
    await user.click(screen.getByRole('button', { name: /查看/ }));

    await waitFor(() => expect(screen.getByText('订单链路预览')).toBeInTheDocument());
    expect(screen.getByText('1 种物料')).toBeInTheDocument();
    expect(screen.queryByText('2 种物料')).not.toBeInTheDocument();
  });

  it('提示信息可折叠查看详情，M2 问题对话框保持可见', async () => {
    const user = userEvent.setup();
    useBusinessRunStore.setState({
      active: true,
      running: false,
      phase: 'human_input_required',
      title: '流程等待人工补充',
      detail: 'M2 requires human input',
      taskId: 'task-m2-collapse',
      run: {
        run_id: 'run-m2-collapse',
        tracking_task_id: 'task-m2-collapse',
        mode: 'real',
        status: 'human_input_required',
        current_node: 'persist_trace',
        steps: [{ node_name: 'resolve_order_from_m1', status: 'completed', module: 'm1' }],
        results: {
          m2: {
            result: {
              open_customer_questions: [
                { question: '请先确认 BOM 模板和物料编号规则', field: 'template_confirmation' },
                { question: '请确认要建立的 BOM 类型', field: 'bom_type' },
              ],
            },
          },
        },
        blocked_reason: { code: 'HUMAN_INPUT_REQUIRED', message: 'M2 requires human input' },
        error: null,
        result_summary: {},
      },
    });
    renderWithApp(<DataFlowPanel />);

    // 提示信息默认折叠：详情与 TaskID 不渲染
    expect(await screen.findByText('链路已安全暂停')).toBeInTheDocument();
    expect(screen.getByText('流程等待人工补充')).toBeInTheDocument();
    expect(screen.queryByText(/M2 requires human input/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-id')).not.toBeInTheDocument();

    // M2 问题对话框保持可见（不折叠）
    expect(screen.getByText('M2 需要人工确认以下物料问题')).toBeInTheDocument();
    expect(screen.getByText('请先确认 BOM 模板和物料编号规则')).toBeInTheDocument();
    expect(screen.getByText('请确认要建立的 BOM 类型')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agent 解析确认并继续' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认缺失，带异常继续' })).not.toBeInTheDocument();

    // 点击提示信息标题展开详情
    await user.click(screen.getByText('链路已安全暂停'));

    expect(await screen.findByText(/M2 requires human input/)).toBeInTheDocument();
    expect(screen.getByTestId('task-id')).toBeInTheDocument();
  });

  it('keeps business-flow writes closed when the role lacks m4:operate', async () => {
    useAuthenticatedPermissions(['leader:read']);
    useBusinessRunStore.setState({
      active: true,
      running: false,
      phase: 'human_input_required',
      title: '流程等待人工补充',
      detail: 'M2 requires human input',
      taskId: 'task-read-only-flow',
      run: {
        run_id: 'run-read-only-flow',
        tracking_task_id: 'task-read-only-flow',
        mode: 'real',
        status: 'human_input_required',
        current_node: 'persist_trace',
        steps: [],
        results: {
          m2: {
            result: {
              open_customer_questions: [
                { question_id: 'q1', field: 'template_confirmation', question: '请确认 BOM 模板', blocking: true },
              ],
            },
          },
        },
        blocked_reason: { code: 'HUMAN_INPUT_REQUIRED', message: 'M2 requires human input' },
        error: null,
        result_summary: {},
      },
    });
    const user = userEvent.setup();
    renderWithApp(<DataFlowPanel />);

    const confirm = await screen.findByRole('button', { name: 'Agent 解析确认并继续' });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('button', { name: /继续运行$/ })).toBeDisabled();
    screen.getAllByRole('button', { name: /运行$/ }).forEach((button) => expect(button).toBeDisabled());

    await user.click(confirm);
    const postCalls = vi.mocked(fetch).mock.calls.filter(([, init]) =>
      String(init?.method ?? 'GET').toUpperCase() === 'POST',
    );
    const businessPostCalls = postCalls.filter(([input]) =>
      !String(input).includes('/api/audit/logs'),
    );
    expect(businessPostCalls).toHaveLength(0);
    expect(postCalls.some(([input]) => String(input).includes('/api/audit/logs'))).toBe(true);
  });

  it('M2 门完整显示同 field 多条问题（含 template_onboarding 来源与原因/影响行）', async () => {
    useBusinessRunStore.setState({
      active: true,
      running: false,
      phase: 'human_input_required',
      title: '流程等待人工补充',
      detail: 'M2 requires human input',
      taskId: 'task-m2-multi',
      run: {
        run_id: 'run-m2-multi',
        tracking_task_id: 'task-m2-multi',
        mode: 'real',
        status: 'human_input_required',
        current_node: 'persist_trace',
        steps: [],
        results: {
          m2: {
            result: {
              open_customer_questions: [
                { question_id: 'q1', field: 'history_reuse', question: '请确认该历史 BOM 是否与当前产品同源', blocking: true },
              ],
              template_onboarding: {
                customer_questions: [
                  { question_id: 'q2', field: 'history_mapping', question: '21年最新成品BOM.xlsx/HDMI19+1全铜: 请确认这些明细挂在哪里', reason: '历史表字段不能静默改变', affected_lines: ['HDMI19+1全铜-1', 'HDMI19+1全铜-2'], blocking: true },
                  { question_id: 'q3', field: 'history_mapping', question: '字段"序号"无法稳定映射到标准模板', reason: '历史表字段不能静默改变', blocking: true },
                ],
              },
            },
          },
        },
        blocked_reason: { code: 'HUMAN_INPUT_REQUIRED', message: 'M2 requires human input' },
        error: null,
        result_summary: {},
      },
    });
    renderWithApp(<DataFlowPanel />);

    // 三条问题都应显示（同 field 的 q2/q3 不被去重吞掉）
    expect(await screen.findByText('请确认该历史 BOM 是否与当前产品同源')).toBeInTheDocument();
    expect(screen.getByText(/请确认这些明细挂在哪里/)).toBeInTheDocument();
    expect(screen.getByText(/字段"序号"无法稳定映射/)).toBeInTheDocument();
    // 原因与影响行显示（同 field 两条 history_mapping 都有原因）
    expect(screen.getAllByText(/原因：历史表字段不能静默改变/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/影响：HDMI19\+1全铜-1；HDMI19\+1全铜-2/)).toBeInTheDocument();
  });

  it('M2 门展示订单涉及物料明细（编码/名称/用量/供应类型）', async () => {
    useBusinessRunStore.setState({
      active: true,
      running: false,
      phase: 'human_input_required',
      title: '流程等待人工补充',
      detail: 'M2 requires human input',
      taskId: 'task-m2-materials',
      run: {
        run_id: 'run-m2-materials',
        tracking_task_id: 'task-m2-materials',
        mode: 'real',
        status: 'human_input_required',
        current_node: 'persist_trace',
        steps: [],
        results: {
          m2: {
            result: {
              bom_generation: {
                standard_bom: {
                  bom_lines: [
                    { component_item: 'CMP-48A4672F8F', component_name: '线材', qty_per: 1, uom: 'PCS', supply_type: 'BUY' },
                    { component_item: 'CMP-BD71592527', component_name: '插头', qty_per: 2, uom: 'PCS', supply_type: 'BUY' },
                    { component_item: '7144内模料', component_name: 'USB2.0 中性28AWG', qty_per: 1, uom: 'PCS', supply_type: 'MAKE' },
                  ],
                },
              },
              open_customer_questions: [
                { question_id: 'q1', field: 'template_confirmation', question: '请先确认 BOM 模板和物料编号规则', blocking: true },
              ],
            },
          },
        },
        blocked_reason: { code: 'HUMAN_INPUT_REQUIRED', message: 'M2 requires human input' },
        error: null,
        result_summary: {},
      },
    });
    renderWithApp(<DataFlowPanel />);

    expect(await screen.findByText(/订单涉及物料明细（3 行/)).toBeInTheDocument();
    expect(screen.getByText(/CMP-48A4672F8F 线材 × 1 PCS（采购件）/)).toBeInTheDocument();
    expect(screen.getByText(/CMP-BD71592527 插头 × 2 PCS（采购件）/)).toBeInTheDocument();
    expect(screen.getByText(/7144内模料 USB2.0 中性28AWG × 1 PCS（自制件）/)).toBeInTheDocument();
  });

  it('人工门展示「缺少以下资料」清单与「上传基础资料（M0）」入口', async () => {
    useBusinessRunStore.setState({
      active: true,
      running: false,
      phase: 'human_input_required',
      title: '流程等待人工补充',
      detail: 'M3 governance review required: UPSTREAM_BOM_NOT_APPROVED_FOR_MRP',
      taskId: 'task-missing-docs',
      missingDocuments: [
        { module: 'm3', file_type: 'bom_approval', reason: 'BOM 未经人工审核批准' },
        { module: 'm2', file_type: 'historical_bom', reason: '缺少可复用历史 BOM' },
      ],
      run: {
        run_id: 'run-missing-docs',
        tracking_task_id: 'task-missing-docs',
        mode: 'real',
        status: 'human_input_required',
        current_node: 'persist_trace',
        steps: [],
        results: {},
        blocked_reason: {
          code: 'HUMAN_INPUT_REQUIRED',
          message: 'M3 governance review required',
          missing_documents: [{ module: 'm3', file_type: 'bom_approval', reason: 'BOM 未经人工审核批准' }],
        },
        error: null,
        result_summary: {},
      },
    });
    renderWithApp(<DataFlowPanel />);

    expect(await screen.findByText('链路已安全暂停')).toBeInTheDocument();
    // 点击展开详情
    await userEvent.setup().click(screen.getByText('链路已安全暂停'));
    expect(await screen.findByText(/缺少以下资料/)).toBeInTheDocument();
    expect(screen.getByText(/BOM 未经人工审核批准/)).toBeInTheDocument();
    expect(screen.getByText(/缺少可复用历史 BOM/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /上传基础资料/ })).toBeInTheDocument();
  });

  it('M3 governance 门展示 BOM 明细与「批准 BOM」按钮', async () => {
    const user = userEvent.setup();
    let approvalCommand: unknown;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/historical-order-catalog.json')) return jsonResponse(catalog);
      if (url.includes('/run-config/candidate-run-manifest.json')) return jsonResponse(manifest);
      if (url.includes('/orchestrator/business-flows/run-bom-approve/resume')) {
        approvalCommand = init?.body ? JSON.parse(String(init.body)) : undefined;
        return jsonResponse({ run_id: 'run-bom-approve', status: 'queued', current_node: 'intake' }, 202);
      }
      if (url.includes('/orchestrator/business-flows/run-bom-approve')) {
        return jsonResponse({
          run_id: 'run-bom-approve',
          tracking_task_id: 'task-bom-approve',
          requested_order_id: 'SO-BOM-APPROVE',
          order_id: 'SO-BOM-APPROVE',
          mode: 'real',
          status: 'completed',
          current_node: 'persist_trace',
          steps: [],
          results: {},
          result_summary: {},
        });
      }
      if (url.includes('/orchestrator/business-orders/')) return jsonResponse(trace);
      return jsonResponse({ items: [] });
    }));
    useBusinessRunStore.setState({
      active: true,
      running: false,
      phase: 'human_input_required',
      title: '流程等待人工补充',
      detail: 'M3 governance review required: UPSTREAM_BOM_NOT_APPROVED_FOR_MRP',
      taskId: 'task-bom-approve',
      runId: 'run-bom-approve',
      meta: { orderId: 'SO-BOM-APPROVE' },
      run: {
        run_id: 'run-bom-approve',
        tracking_task_id: 'task-bom-approve',
        mode: 'real',
        status: 'human_input_required',
        current_node: 'persist_trace',
        steps: [],
        results: {
          m2: {
            result: {
              bom_generation: {
                standard_bom: {
                  bom_lines: [
                    { component_item: 'XU2007', component_name: '黑色ETR线材', qty_per: 1.4, uom: 'M', scrap_pct: 0.02, supply_type: 'BUY' },
                  ],
                },
              },
            },
          },
        },
        blocked_reason: { code: 'HUMAN_INPUT_REQUIRED', message: 'M3 governance review required: UPSTREAM_BOM_NOT_APPROVED_FOR_MRP' },
        error: null,
        result_summary: {},
      },
    });
    renderWithApp(<DataFlowPanel />);

    expect(await screen.findByText('M3 上游 BOM 未批准，需人工审核')).toBeInTheDocument();
    expect(screen.getByText(/XU2007/)).toBeInTheDocument();
    expect(screen.getByText(/黑色ETR线材/)).toBeInTheDocument();
    const approveButtonName = '审核通过，批准 BOM 并继续';
    expect(screen.getByRole('button', { name: approveButtonName })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: approveButtonName })).toBeEnabled());
    // XMOD-P0-01：越闸按钮「确认缺失，带异常继续」已删除，不再提供异常继续。
    expect(screen.queryByRole('button', { name: '确认缺失，带异常继续' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: approveButtonName }));
    await waitFor(() => {
      expect(approvalCommand).toEqual({ action: 'approve_bom_for_m0_publication' });
    });
  });

  it('缺少 M0 BOM 审批权限时禁用发布且不发送 resume POST', async () => {
    const user = userEvent.setup();
    let resumeCalls = 0;
    useAuthenticatedPermissions(['m4:operate']);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/historical-order-catalog.json')) return jsonResponse(catalog);
      if (url.includes('/run-config/candidate-run-manifest.json')) return jsonResponse(manifest);
      if (url.includes('/orchestrator/business-flows/run-bom-denied/resume')) {
        resumeCalls += 1;
        return jsonResponse({}, 202);
      }
      if (url.includes('/orchestrator/business-orders/')) return jsonResponse(trace);
      return jsonResponse({ items: [] });
    }));
    useBusinessRunStore.setState({
      active: true,
      running: false,
      phase: 'human_input_required',
      title: '流程等待人工补充',
      detail: 'M3 governance review required: UPSTREAM_BOM_NOT_APPROVED_FOR_MRP',
      taskId: 'task-bom-denied',
      runId: 'run-bom-denied',
      meta: { orderId: 'SO-BOM-DENIED' },
      run: {
        run_id: 'run-bom-denied',
        tracking_task_id: 'task-bom-denied',
        mode: 'real',
        status: 'human_input_required',
        current_node: 'persist_trace',
        steps: [],
        results: {
          m2: {
            result: {
              bom_generation: {
                standard_bom: {
                  bom_lines: [
                    { component_item: 'XU2007', component_name: '黑色ETR线材', qty_per: 1.4, uom: 'M' },
                  ],
                },
              },
            },
          },
        },
        blocked_reason: { code: 'HUMAN_INPUT_REQUIRED', message: 'UPSTREAM_BOM_NOT_APPROVED_FOR_MRP' },
        error: null,
        result_summary: {},
      },
    });
    renderWithApp(<DataFlowPanel />);

    const approveButton = await screen.findByRole('button', { name: '审核通过，批准 BOM 并继续' });
    expect(approveButton).toBeDisabled();
    await user.click(approveButton);
    expect(resumeCalls).toBe(0);
  });

  it('data_incomplete 时展示「数据未完善」卡片与缺失明细，且无越闸按钮', async () => {
    useBusinessRunStore.setState({
      active: true,
      running: false,
      phase: 'data_incomplete',
      title: '数据未完善',
      detail: 'M5 权威产能事实未完善，等待补齐后恢复',
      taskId: 'task-incomplete-1',
      missing: [
        {
          module: 'm2',
          capability: 'released_engineering_package',
          fields: ['routing_steps', 'resources', 'calendars'],
          owner: 'm2',
          resume_from: 'solve_schedule',
        },
        {
          module: 'm3',
          capability: 'material_readiness_snapshot',
          fields: ['material_availability', 'plan_lines'],
          owner: 'm3',
          resume_from: 'solve_schedule',
        },
      ],
      run: {
        run_id: 'run-incomplete-1',
        tracking_task_id: 'task-incomplete-1',
        mode: 'real',
        status: 'data_incomplete',
        current_node: 'solve_schedule',
        steps: [{ node_name: 'resolve_order_from_m1', status: 'completed', module: 'm1' }],
        results: {},
        blocked_reason: { code: 'DATA_INCOMPLETE', message: 'M5 权威产能事实未完善，等待补齐后恢复' },
        error: {
          code: 'DATA_INCOMPLETE',
          data_incomplete: {
            title: '数据未完善',
            production_eligible: false,
            missing: [
              {
                module: 'm2',
                capability: 'released_engineering_package',
                fields: ['routing_steps', 'resources', 'calendars'],
                owner: 'm2',
                resume_from: 'solve_schedule',
              },
            ],
          },
        },
        result_summary: {},
      },
    });
    renderWithApp(<DataFlowPanel />);

    expect((await screen.findAllByText('数据未完善')).length).toBeGreaterThan(0);
    // 缺失明细：模块/能力/责任方/恢复节点
    expect(screen.getByText(/缺失模块 m2/)).toBeInTheDocument();
    expect(screen.getByText(/released_engineering_package/)).toBeInTheDocument();
    expect(screen.getByText(/责任方 m2/)).toBeInTheDocument();
    expect((await screen.findAllByText(/恢复节点 solve_schedule/)).length).toBeGreaterThan(0);
    // 完全缺数据时只能补齐后重试，不展示允许/拒绝越闸。
    expect(screen.getByRole('button', { name: /数据补齐后重试$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /允许$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /拒绝$/ })).not.toBeInTheDocument();
    // 越闸按钮不得出现
    expect(screen.queryByRole('button', { name: '确认缺失，带异常继续' })).not.toBeInTheDocument();
  });

  it('仅缺 routing_steps 时显示模拟工艺三选项，并沿同 TaskID 允许继续', async () => {
    const user = userEvent.setup();
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      if (url.includes('/historical-order-catalog.json')) return jsonResponse(catalog);
      if (url.includes('/run-config/candidate-run-manifest.json')) return jsonResponse(manifest);
      if (url.includes('/orchestrator/business-flows/run-route-gate/resume')) {
        return jsonResponse({ run_id: 'run-route-gate', status: 'queued', current_node: 'intake' });
      }
      if (url.includes('/orchestrator/business-flows/run-route-gate')) {
        return jsonResponse({
          run_id: 'run-route-gate',
          tracking_task_id: 'task-route-gate',
          requested_order_id: 'ORDER-CAT8-1',
          order_id: 'ORDER-CAT8-1',
          mode: 'real',
          status: 'completed',
          current_node: 'persist_trace',
          steps: [],
          results: {
            simulated_engineering_route_receipt: { status: 'approved', simulation_only: true },
          },
          result_summary: {},
        });
      }
      if (url.includes('/orchestrator/business-orders/')) return jsonResponse(trace);
      return jsonResponse({ items: [] });
    }));
    const missing = [{
      module: 'm2',
      capability: 'released_engineering_package',
      fields: ['routing_steps'],
      owner: 'm2',
      resume_from: 'solve_schedule',
    }];
    useBusinessRunStore.setState({
      active: true,
      running: false,
      phase: 'data_incomplete',
      title: '数据未完善',
      detail: 'CAT8 未匹配到已发布工艺',
      taskId: 'task-route-gate',
      runId: 'run-route-gate',
      meta: { orderId: 'ORDER-CAT8-1' },
      missing,
      gate: {
        gateCode: 'm2_engineering_route_unmatched',
        gateKind: 'exception',
        severity: 'warning',
        title: '工艺匹配异常',
        defaultAction: 'allow',
        allowedActions: ['allow', 'reject', 'pause_modify'],
        evidenceSummary: 'CAT8 未匹配到已发布工艺；允许后使用通用模拟工艺继续',
        evidenceDigest: 'e'.repeat(64),
      },
      run: {
        run_id: 'run-route-gate',
        tracking_task_id: 'task-route-gate',
        requested_order_id: 'ORDER-CAT8-1',
        order_id: 'ORDER-CAT8-1',
        mode: 'real',
        status: 'data_incomplete',
        current_node: 'solve_schedule',
        steps: [],
        results: {
          m3: {
            data: {
              order: {
                order_id: 'ORDER-CAT8-1',
                product_name: 'CAT8 FTP cable',
                order_qty: 100,
                due_date: '2026-09-30',
              },
            },
          },
        },
        blocked_reason: {
          code: 'DATA_INCOMPLETE',
          message: 'routing is not matched',
          gate_code: 'm2_engineering_route_unmatched',
          gate_kind: 'exception',
          allowed_actions: ['allow', 'reject', 'pause_modify'],
          evidence_digest: 'e'.repeat(64),
        },
        error: { code: 'DATA_INCOMPLETE', data_incomplete: { missing } },
        result_summary: {},
      },
    });

    renderWithApp(<DataFlowPanel />);

    expect(await screen.findByTestId('simulated-engineering-route-gate')).toBeInTheDocument();
    expect(screen.getByText('模拟工艺闭环')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /数据补齐后重试$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /允许$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /拒绝$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /暂停修改$/ })).toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole('button', { name: /允许$/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /允许$/ }));

    await waitFor(() => expect(calls.some((call) => call.url.includes('/resume'))).toBe(true));
    const resume = calls.find((call) => call.url.includes('/resume'));
    expect(resume?.body).toEqual({
      action: 'allow',
      gate_code: 'm2_engineering_route_unmatched',
      evidence_digest: 'e'.repeat(64),
    });
  });

  it('M1 人工门展示识别到的订单明细（具体反馈）', async () => {
    useBusinessRunStore.setState({
      active: true,
      running: false,
      phase: 'human_input_required',
      title: '流程等待人工补充',
      detail: 'M0 订单解析需人工复核：中性 HDTV2.1 8K 高清线10M (W-H915) ×1000',
      taskId: 'task-m1-gate',
      run: {
        run_id: 'run-m1-gate',
        tracking_task_id: 'task-m1-gate',
        mode: 'real',
        status: 'human_input_required',
        current_node: 'persist_trace',
        steps: [{ node_name: 'resolve_order_from_m1', status: 'completed', module: 'm1' }],
        results: {
          m1: {
            document: {
              lines: [
                { name_raw: '中性 HDTV2.1 8K 高清线10M', model: 'W-H915', quantity: 1000 },
              ],
            },
          },
        },
        blocked_reason: { code: 'HUMAN_INPUT_REQUIRED', message: 'M0 订单解析需人工复核：中性 HDTV2.1 8K 高清线10M (W-H915) ×1000' },
        error: null,
        result_summary: {},
      },
    });
    renderWithApp(<DataFlowPanel />);

    expect(await screen.findByText('M0 订单解析需人工复核')).toBeInTheDocument();
    expect(screen.getByText(/中性 HDTV2\.1 8K 高清线10M/)).toBeInTheDocument();
    expect(screen.getByText(/W-H915/)).toBeInTheDocument();
    expect(screen.getByText(/1000/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '订单无误可继续' })).toBeEnabled());
    expect(screen.getByRole('button', { name: '需要补充信息' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '退出受治理流程' })).toBeInTheDocument();
  });

  it('M1 完全未识别到数量时禁止空确认，补充正数后放行', async () => {
    useBusinessRunStore.setState({
      active: true,
      running: false,
      phase: 'human_input_required',
      title: '流程等待人工补充',
      detail: 'M1 未识别到有效订单数量，请补充大于 0 的数量后继续',
      taskId: 'task-m1-no-qty',
      run: {
        run_id: 'run-m1-no-qty',
        tracking_task_id: 'task-m1-no-qty',
        mode: 'real',
        status: 'human_input_required',
        current_node: 'resolve_order_from_m1',
        steps: [{ node_name: 'resolve_order_from_m1', status: 'human_input_required', module: 'm1' }],
        results: { m1: { needs_review: true, document: { lines: [] } } },
        blocked_reason: {
          code: 'HUMAN_INPUT_REQUIRED',
          message: 'M1 未识别到有效订单数量，请补充大于 0 的数量后继续',
        },
        error: null,
        result_summary: {},
      },
    });
    renderWithApp(<DataFlowPanel />);

    const confirm = await screen.findByRole('button', { name: '订单无误可继续' });
    expect(confirm).toBeDisabled();
    expect(screen.getByText('未识别到订单数量，请在下方补充大于 0 的数量后继续。')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('M1 数量'), { target: { value: '12' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '订单无误可继续' })).toBeEnabled());
    expect(screen.getByRole('button', { name: '已补充完毕可以继续' })).toBeInTheDocument();
  });

  it('M1 订单身份门解包真实响应并要求填写订单号，且不显示通用继续', async () => {
    const user = userEvent.setup();
    useBusinessRunStore.setState({
      active: true,
      running: false,
      phase: 'human_input_required',
      title: '流程等待人工补充',
      detail: 'M1 订单身份缺失：未从订单内容或文件名识别到唯一订单号，请补充订单号后继续',
      taskId: 'task-m1-no-order-id',
      runId: 'run-m1-no-order-id',
      missingDocuments: [
        {
          module: 'm1',
          field: 'm1_review_overrides.order_id',
          reason: '订单号完全缺失',
        },
      ],
      run: {
        run_id: 'run-m1-no-order-id',
        tracking_task_id: 'task-m1-no-order-id',
        mode: 'real',
        status: 'human_input_required',
        current_node: 'resolve_order_from_m1',
        steps: [{ node_name: 'resolve_order_from_m1', status: 'human_input_required', module: 'm1' }],
        results: {
          m1: {
            success: true,
            data: {
              document: {
                lines: [
                  { name_raw: 'HDTV 8K 多变形线', quantity: 25, uom: 'PCS' },
                ],
              },
            },
          },
        },
        blocked_reason: {
          code: 'HUMAN_INPUT_REQUIRED',
          message: 'M1 订单身份缺失：未从订单内容或文件名识别到唯一订单号，请补充订单号后继续',
          missing_documents: [
            {
              module: 'm1',
              field: 'm1_review_overrides.order_id',
              reason: '订单号完全缺失',
            },
          ],
        },
        error: null,
        result_summary: {},
      },
    });
    renderWithApp(<DataFlowPanel />);

    expect(await screen.findByText(/HDTV 8K 多变形线/)).toBeInTheDocument();
    expect(screen.getByText(/× 25 PCS/)).toBeInTheDocument();
    expect(screen.getByText('订单身份缺失或存在冲突，请在下方确认订单号后继续。')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: '订单无误可继续' });
    expect(confirm).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^继续运行$/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('M1 订单号'), { target: { value: 'CG2409180002' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '订单无误可继续' })).toBeEnabled());
    expect(screen.getByRole('button', { name: '已补充完毕可以继续' })).toBeInTheDocument();

    act(() => {
      const current = useBusinessRunStore.getState();
      useBusinessRunStore.setState({
        runId: 'run-m1-no-order-id-b',
        taskId: 'task-m1-no-order-id-b',
        run: current.run
          ? {
            ...current.run,
            run_id: 'run-m1-no-order-id-b',
            tracking_task_id: 'task-m1-no-order-id-b',
          }
          : current.run,
      });
    });
    await waitFor(() => expect(screen.getByLabelText('M1 订单号')).toHaveValue(''));
    expect(screen.getByRole('button', { name: '订单无误可继续' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('M1 订单号'), { target: { value: 'CG2409180002' } });
    await user.click(screen.getByRole('button', { name: '订单无误可继续' }));
    await waitFor(() => expect(
      vi.mocked(fetch).mock.calls.some(([input, init]) =>
        String(input).includes('/orchestrator/business-flows/run-m1-no-order-id-b/resume')
        && String(init?.method ?? 'GET').toUpperCase() === 'POST'),
    ).toBe(true));
    const resumeCall = vi.mocked(fetch).mock.calls.find(([input]) =>
      String(input).includes('/orchestrator/business-flows/run-m1-no-order-id-b/resume'));
    expect(JSON.parse(String(resumeCall?.[1]?.body))).toEqual({
      action: 'continue',
      supplement: {
        m1_review_overrides: { order_id: 'CG2409180002' },
      },
    });
  });

  it('run blocked 且历史 trace 有 M2-M5 数据时，M2-M5 显示「已有数据」而非完成', async () => {
    useBusinessRunStore.setState({
      active: true,
      running: false,
      phase: 'blocked',
      title: '链路已安全阻断',
      detail: 'M5 authoritative capacity facts are missing',
      taskId: 'task-blocked-trace',
      trace,
      run: {
        run_id: 'run-blocked-trace',
        tracking_task_id: 'task-blocked-trace',
        mode: 'real',
        status: 'blocked',
        current_node: 'solve_schedule',
        steps: [{ node_name: 'resolve_order_from_m1', status: 'completed', module: 'm1' }],
        results: {},
        blocked_reason: { code: 'MISSING_AUTHORITY_FACTS', message: 'M5 authoritative capacity facts are missing' },
        error: null,
        result_summary: {},
      },
    });
    renderWithApp(<DataFlowPanel />);

    // active 运行会自动展开大屏
    expect(await screen.findByTestId('data-flow-overlay')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('已有数据').length).toBe(4));
    expect(screen.getAllByText('完成').length).toBe(1);
    expect(document.querySelectorAll(`[aria-label="订单到排程 数据流动"] .${styles['is-data-only']}`).length).toBe(4);
  });

  it('当前任务失败时不加载同订单历史 PMC，并明确标记历史来源', async () => {
    useBusinessRunStore.setState({
      active: true,
      running: false,
      phase: 'failed',
      title: '业务流程运行失败',
      detail: 'M4 生成采购单失败',
      taskId: 'task-current-failed',
      trace: {
        ...trace,
        schedule_versions: [{
          schedule_id: 'cp-historical',
          tracking_task_id: 'task-historical',
        }],
      },
      run: {
        run_id: 'run-current-failed',
        tracking_task_id: 'task-current-failed',
        mode: 'real',
        status: 'failed',
        current_node: 'create_or_update_purchase_orders',
        steps: [],
        results: {},
        blocked_reason: null,
        error: { message: 'M4 生成采购单失败' },
        result_summary: {},
      },
    });
    renderWithApp(<DataFlowPanel />);

    expect(await screen.findByText('本次任务未生成 PMC')).toBeInTheDocument();
    expect(screen.getByText('该订单存在历史排程 cp-historical，未计入本次任务。')).toBeInTheDocument();
    expect(screen.queryByTestId('m5-pmc-summary')).not.toBeInTheDocument();
  });

  it('连接线：运行中流动、完成后停止', async () => {
    useBusinessRunStore.setState({
      active: true,
      running: true,
      phase: 'm1_m2',
      title: '执行中',
      detail: '运行中',
      run: {
        run_id: 'run-1',
        tracking_task_id: 'task-1',
        mode: 'real',
        status: 'running',
        current_node: 'resolve_or_generate_bom',
        steps: [{ node_name: 'resolve_order_from_m1', status: 'completed', module: 'm1' }],
        results: {},
        blocked_reason: null,
        error: null,
        result_summary: {},
      },
    });
    const { rerender } = renderWithApp(<DataFlowPanel />);

    const track = '[aria-label="订单到排程 数据流动"]';
    expect(document.querySelectorAll(`${track} .${styles.isFlowing}`).length).toBeGreaterThan(0);
    expect(document.querySelectorAll(`${track} .${styles.isDone}`).length).toBeGreaterThan(0);

    act(() => {
      useBusinessRunStore.setState({
        running: false,
        phase: 'done',
        run: {
          run_id: 'run-1',
          tracking_task_id: 'task-1',
          mode: 'real',
          status: 'completed',
          current_node: 'persist_trace',
          steps: [{ node_name: 'resolve_order_from_m1', status: 'completed', module: 'm1' }],
          results: {},
          blocked_reason: null,
          error: null,
          result_summary: {},
        },
      });
    });
    rerender(<DataFlowPanel />);

    expect(document.querySelectorAll(`${track} .${styles.isFlowing}`).length).toBe(0);
    expect(document.querySelectorAll(`${track} .${styles.isDone}`).length).toBe(4);
  });

  it('M5 门禁点击 fixture：只 resume 传服务端构建标记，不直调 M5 求解器', async () => {
    const user = userEvent.setup();
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      let body: unknown;
      if (init?.body) {
        try {
          body = JSON.parse(String(init.body));
        } catch {
          body = String(init.body);
        }
      }
      calls.push({ url, method, body });
      if (url.includes('/historical-order-catalog.json')) return jsonResponse(catalog);
      if (url.includes('/run-config/candidate-run-manifest.json')) return jsonResponse(manifest);
      if (url.includes('/orchestrator/business-flows/run-m5-gate/resume')) {
        return jsonResponse({ run_id: 'run-m5-gate', status: 'queued', current_node: 'intake' });
      }
      if (url.includes('/orchestrator/business-flows/run-m5-gate')) {
        return jsonResponse({
          run_id: 'run-m5-gate',
          tracking_task_id: 'task-m5-gate',
          requested_order_id: 'SO-HIST-20260724-008',
          order_id: 'SO-HIST-20260724-008',
          mode: 'real',
          status: 'completed',
          current_node: 'persist_trace',
          steps: [],
          results: {},
          blocked_reason: null,
          error: null,
          result_summary: {},
        });
      }
      if (url.includes('/orchestrator/business-orders/')) return jsonResponse(trace);
      return jsonResponse({ items: [] });
    }));
    useBusinessRunStore.setState({
      active: true,
      running: false,
      phase: 'blocked',
      title: '权威条件未满足',
      detail: 'M5 authoritative capacity facts are missing',
      taskId: 'task-m5-gate',
      runId: 'run-m5-gate',
      meta: { orderId: 'SO-HIST-20260724-008' },
      run: {
        run_id: 'run-m5-gate',
        tracking_task_id: 'task-m5-gate',
        requested_order_id: 'SO-HIST-20260724-008',
        order_id: 'SO-HIST-20260724-008',
        mode: 'real',
        status: 'blocked',
        current_node: 'solve_schedule',
        steps: [],
        results: {},
        blocked_reason: { code: 'MISSING_AUTHORITY_FACTS', message: 'M5 authoritative capacity facts are missing' },
        error: null,
        result_summary: {},
      },
    });
    renderWithApp(<DataFlowPanel />);

    await screen.findByRole('button', { name: '载入受控排程 fixture 并继续' });
    await waitFor(() => expect(screen.getByRole('button', { name: '载入受控排程 fixture 并继续' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: '载入受控排程 fixture 并继续' }));

    await waitFor(() => {
      expect(calls.some((call) => call.url.includes('/orchestrator/business-flows/run-m5-gate/resume'))).toBe(true);
    });

    const resumeCall = calls.find((call) => call.url.includes('/orchestrator/business-flows/run-m5-gate/resume'));
    expect(resumeCall?.method).toBe('POST');
    const command = (resumeCall?.body ?? {}) as {
      action?: string;
      supplement?: { m5_payload?: { fixture?: string; scenario_purpose?: string } };
    };
    expect(command.action).toBe('continue');
    expect(command.supplement?.m5_payload?.fixture).toBe('standard-4station');
    expect(command.supplement?.m5_payload?.scenario_purpose).toBe('pressure_only');
    expect(await screen.findByText('演示完成（非生产）')).toBeInTheDocument();
    expect(screen.getByText(/受控 fixture · pressure_only · 不可审批/)).toBeInTheDocument();

    // 前端不得直调 M5 求解器：服务端构建替代前端 loadM5Fixture 直调。
    expect(calls.some((call) => call.url.includes('/m5/schedule-candidates'))).toBe(false);
  });

  it('真实模式补货落库失败时停止，不向编排器发送 resume', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/historical-order-catalog.json')) return jsonResponse(catalog);
      if (url.includes('/run-config/candidate-run-manifest.json')) return jsonResponse(manifest);
      if (url.includes('/m3/supply/restock')) {
        return jsonResponse({ detail: 'inventory database unavailable' }, 500);
      }
      if (url.includes('/orchestrator/business-flows/run-restock-failed/resume')) {
        return jsonResponse({ run_id: 'run-restock-failed', status: 'queued' });
      }
      return jsonResponse({ items: [] });
    }));
    useBusinessRunStore.setState({
      active: true,
      running: false,
      phase: 'blocked',
      title: '链路已安全阻断',
      detail: 'M3 缺料 MAT-1',
      taskId: 'task-restock-failed',
      runId: 'run-restock-failed',
      meta: { orderId: 'ORDER-RESTOCK-1' },
      run: {
        run_id: 'run-restock-failed',
        tracking_task_id: 'task-restock-failed',
        requested_order_id: 'ORDER-RESTOCK-1',
        order_id: 'ORDER-RESTOCK-1',
        mode: 'real',
        status: 'blocked',
        current_node: 'check_material_readiness',
        request: { m3_payload: { inventory_snapshot: [] } },
        steps: [],
        results: {
          m3: {
            data: {
              project_id: 'PROJECT-RESTOCK-1',
              shortage_lines: [
                {
                  material_code: 'MAT-1',
                  material_name: '线材',
                  shortage_qty: 8,
                  suggest_purchase_qty: 8,
                  uom: 'M',
                },
              ],
            },
          },
        },
        blocked_reason: { code: 'MISSING_AUTHORITY_FACTS', message: 'M3 缺料 MAT-1' },
        error: null,
        result_summary: {},
      },
    });
    renderWithApp(<DataFlowPanel />);

    await screen.findByRole('button', { name: '补货入账并继续' });
    await waitFor(() => expect(screen.getByRole('button', { name: '补货入账并继续' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: '补货入账并继续' }));

    await waitFor(() => {
      expect(calls.some((url) => url.includes('/m3/supply/restock'))).toBe(true);
    });
    expect(calls.some((url) => url.includes('/orchestrator/business-flows/run-restock-failed/resume'))).toBe(false);
    expect(useBusinessRunStore.getState().phase).toBe('failed');
    expect(useBusinessRunStore.getState().detail).toContain('补货入账失败');
  });

  it('类型化 M3 短缺门只显示允许、拒绝、暂停修改，允许不伪造补货入账', async () => {
    const user = userEvent.setup();
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      if (url.includes('/historical-order-catalog.json')) return jsonResponse(catalog);
      if (url.includes('/run-config/candidate-run-manifest.json')) return jsonResponse(manifest);
      if (url.includes('/orchestrator/business-flows/run-typed-shortage/resume')) {
        return jsonResponse({ run_id: 'run-typed-shortage', status: 'queued', current_node: 'intake' });
      }
      if (url.includes('/orchestrator/business-flows/run-typed-shortage')) {
        return jsonResponse({
          run_id: 'run-typed-shortage',
          tracking_task_id: 'task-typed-shortage',
          requested_order_id: 'ORDER-TYPED-1',
          order_id: 'ORDER-TYPED-1',
          mode: 'real',
          status: 'completed',
          current_node: 'persist_trace',
          steps: [],
          result_summary: {},
        });
      }
      if (url.includes('/orchestrator/business-orders/')) return jsonResponse(trace);
      return jsonResponse({ items: [] });
    }));
    useBusinessRunStore.setState({
      active: true,
      running: false,
      phase: 'blocked',
      title: '流程已暂停',
      detail: '这段文案不再用于判断弹窗类型',
      taskId: 'task-typed-shortage',
      runId: 'run-typed-shortage',
      meta: { orderId: 'ORDER-TYPED-1' },
      gate: {
        gateCode: 'm3_material_shortage',
        gateKind: 'exception',
        severity: 'warning',
        title: '物料短缺',
        defaultAction: 'allow',
        allowedActions: ['allow', 'reject', 'pause_modify'],
        evidenceSummary: '缺料 1 项（MAT-1）',
        evidenceDigest: 'd'.repeat(64),
      },
      run: {
        run_id: 'run-typed-shortage',
        tracking_task_id: 'task-typed-shortage',
        requested_order_id: 'ORDER-TYPED-1',
        order_id: 'ORDER-TYPED-1',
        mode: 'real',
        status: 'blocked',
        current_node: 'check_material_readiness',
        steps: [],
        results: {
          m3: { data: { shortage_lines: [{ material_code: 'MAT-1', shortage_qty: 8 }] } },
        },
        blocked_reason: { code: 'MISSING_AUTHORITY_FACTS', message: '旧文案' },
        error: null,
        result_summary: {},
      },
    });

    renderWithApp(<DataFlowPanel />);

    expect(await screen.findByTestId('exception-decision-gate')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /允许$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /拒绝$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /暂停修改$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '补货入账并继续' })).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole('button', { name: /允许$/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /允许$/ }));

    await waitFor(() => {
      expect(calls.some((call) => call.url.includes('/resume'))).toBe(true);
    });
    const resume = calls.find((call) => call.url.includes('/resume'));
    expect(resume?.body).toEqual({
      action: 'allow',
      gate_code: 'm3_material_shortage',
      evidence_digest: 'd'.repeat(64),
    });
    expect(calls.some((call) => call.url.includes('/m3/supply/restock'))).toBe(false);
  });

  it('M5 物料准入失败可确认模拟到货并沿同 TaskID 继续', async () => {
    const user = userEvent.setup();
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      if (url.includes('/historical-order-catalog.json')) return jsonResponse(catalog);
      if (url.includes('/run-config/candidate-run-manifest.json')) return jsonResponse(manifest);
      if (url.includes('/orchestrator/business-flows/run-sim-recovery/resume')) {
        return jsonResponse({ run_id: 'run-sim-recovery', status: 'queued', current_node: 'intake' });
      }
      if (url.includes('/orchestrator/business-flows/run-sim-recovery')) {
        return jsonResponse({
          run_id: 'run-sim-recovery',
          tracking_task_id: 'task-sim-recovery',
          requested_order_id: 'ORDER-SIM-1',
          order_id: 'ORDER-SIM-1',
          mode: 'real',
          status: 'completed',
          current_node: 'persist_trace',
          steps: [],
          result_summary: {},
          results: {
            simulated_procurement_receipt: { status: 'all_received', simulation_only: true },
          },
        });
      }
      if (url.includes('/orchestrator/business-orders/')) return jsonResponse(trace);
      return jsonResponse({ items: [] });
    }));
    useBusinessRunStore.setState({
      active: true,
      running: false,
      phase: 'failed',
      title: '业务流程运行失败',
      detail: '[solve_schedule] M5_SCHEDULE_READINESS_FAILED: material-or-kitting',
      error: 'M5_SCHEDULE_READINESS_FAILED: material-or-kitting',
      taskId: 'task-sim-recovery',
      runId: 'run-sim-recovery',
      meta: { orderId: 'ORDER-SIM-1' },
      run: {
        run_id: 'run-sim-recovery',
        tracking_task_id: 'task-sim-recovery',
        requested_order_id: 'ORDER-SIM-1',
        order_id: 'ORDER-SIM-1',
        mode: 'real',
        status: 'failed',
        current_node: 'solve_schedule',
        steps: [],
        results: {
          m3: { data: { shortage_lines: [{ material_code: 'MAT-1', shortage_qty: 8 }] } },
        },
        error: { code: 'M5_SCHEDULE_READINESS_FAILED', message: 'material-or-kitting' },
        blocked_reason: null,
        result_summary: {},
      },
    });

    renderWithApp(<DataFlowPanel />);
    const action = await screen.findByRole('button', { name: /确认模拟采购已到货并继续/ });
    await waitFor(() => expect(action).toBeEnabled());
    await user.click(action);

    await waitFor(() => expect(calls.some((call) => call.url.includes('/resume'))).toBe(true));
    const resume = calls.find((call) => call.url.includes('/resume'));
    expect(resume?.body).toMatchObject({
      action: 'confirm_simulated_procurement_received',
    });
    expect(calls.some((call) => call.url.includes('/m3/supply/restock'))).toBe(false);
  });

  it('M0 发布重试门保留 BOM 明细和全量预览', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    useBusinessRunStore.setState({
      active: true,
      running: false,
      phase: 'human_input_required',
      title: '流程等待人工补充',
      detail: 'M0_CANONICAL_PUBLICATION_FAILED',
      taskId: 'task-bom-publication-preview',
      runId: 'run-bom-publication-preview',
      gate: {
        gateCode: 'm0_bom_publication_retry',
        gateKind: 'exception',
        severity: 'warning',
        title: 'BOM 发布异常',
        defaultAction: 'allow',
        allowedActions: ['allow', 'reject', 'pause_modify'],
        evidenceSummary: 'BOM 审批已保留；允许后将按同一候选重试发布',
        evidenceDigest: 'e'.repeat(64),
      },
      run: {
        run_id: 'run-bom-publication-preview',
        tracking_task_id: 'task-bom-publication-preview',
        requested_order_id: 'ORDER-BOM-PREVIEW',
        order_id: 'ORDER-BOM-PREVIEW',
        mode: 'real',
        status: 'human_input_required',
        current_node: 'publish_bom_to_m0',
        steps: [],
        results: {
          m2_bom_publication_candidate: {
            source_line_count: 3,
            publishable_line_count: 2,
            excluded_line_count: 1,
            defaulted_line_count: 1,
            issue_count: 2,
            bom_lines: [
              {
                component_item: 'D.01.0126083',
                component_name: '光纤铜混合缆',
                qty_per: 10.5,
                uom: 'M',
                scrap_pct: 0,
                supply_type: 'BUY',
              },
              {
                component_item: 'YA.A.01.0145003',
                component_name: 'HDMI A口光纤插头料',
                qty_per: 2,
                uom: 'PCS',
                scrap_pct: 0,
                supply_type: 'BUY',
              },
            ],
          },
          m2: {
            result: {
              bom_generation: {
                standard_bom: {
                  bom_lines: [
                    {
                      component_item: 'D.01.0126083',
                      component_name: '光纤铜混合缆',
                      qty_per: 10.5,
                      uom: 'M',
                      scrap_pct: 0,
                      supply_type: 'BUY',
                    },
                    {
                      component_item: '加工费',
                      component_name: '光纤组装加工费',
                      qty_per: 1,
                      uom: '条',
                      scrap_pct: 0,
                      supply_type: 'MAKE',
                    },
                  ],
                },
              },
            },
          },
        },
        blocked_reason: { code: 'M0_CANONICAL_PUBLICATION_FAILED', message: '发布失败' },
        error: null,
        result_summary: {},
      },
    });

    renderWithApp(<DataFlowPanel />);

    expect(await screen.findByTestId('bom-publication-preview')).toBeInTheDocument();
    expect(screen.getByText(/D\.01\.0126083.*用量 10\.5/)).toBeInTheDocument();
    expect(screen.getByText(/YA\.A\.01\.0145003.*用量 2/)).toBeInTheDocument();
    expect(screen.queryByText(/加工费.*用量 1/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /允许$/ })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /预览全部 BOM 明细$/ }));
    expect(await screen.findByText('待批准 BOM 明细（2 行）')).toBeInTheDocument();
    expect(screen.getByText('光纤铜混合缆')).toBeInTheDocument();
    expect(screen.getByText('HDMI A口光纤插头料')).toBeInTheDocument();
  });

  it('BOM 发布异常门没有可预览明细时禁用允许', async () => {
    useBusinessRunStore.setState({
      active: true,
      running: false,
      phase: 'human_input_required',
      title: '流程等待人工补充',
      detail: 'BOM_NOT_APPROVED_FOR_CANONICAL_PUBLICATION',
      taskId: 'task-bom-publication-empty',
      runId: 'run-bom-publication-empty',
      gate: {
        gateCode: 'm3_bom_publication',
        gateKind: 'exception',
        severity: 'critical',
        title: 'BOM 发布待批准',
        defaultAction: 'allow',
        allowedActions: ['allow', 'reject', 'pause_modify'],
        evidenceSummary: '当前 BOM 候选需授权批准后发布给 M3',
        evidenceDigest: 'f'.repeat(64),
      },
      run: {
        run_id: 'run-bom-publication-empty',
        tracking_task_id: 'task-bom-publication-empty',
        mode: 'real',
        status: 'human_input_required',
        current_node: 'publish_bom_to_m0',
        steps: [],
        results: { m2: { result: {} } },
        blocked_reason: { code: 'BOM_NOT_APPROVED_FOR_CANONICAL_PUBLICATION', message: '待审批' },
        error: null,
        result_summary: {},
      },
    });

    renderWithApp(<DataFlowPanel />);

    expect(await screen.findByText('当前没有可预览的 BOM 明细，不能批准发布')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /允许$/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /暂停修改$/ })).toBeEnabled();
  });

  it('只显示当前 Gate，终态关闭人工匹配弹窗且不发送写请求', async () => {
    const user = userEvent.setup();
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url.includes('/historical-order-catalog.json')) return jsonResponse(catalog);
      if (url.includes('/run-config/candidate-run-manifest.json')) return jsonResponse(manifest);
      return jsonResponse({ items: [] });
    }));

    const staleResults = {
      m2: {
        result: {
          open_customer_questions: [
            { question_id: 'stale-m2', field: 'history_mapping', question: '残留的 M2 人工问题', blocking: true },
          ],
          bom_generation: {
            standard_bom: {
              bom_lines: [{ component_item: 'MAT-1', component_name: '线材', qty_per: 8, uom: 'M', supply_type: 'BUY' }],
            },
          },
        },
      },
      m3: {
        material_matching: [
          {
            source_material: { material_code: 'MAT-1', material_name: '线材' },
            deterministic_result: {
              status: 'review_required',
              candidates: [{ material_code: 'ERP-MAT-1', material_name: 'ERP 线材', score: 0.8 }],
            },
          },
        ],
        data: {
          project_id: 'PROJECT-TERMINAL',
          shortage_lines: [
            { material_code: 'MAT-1', material_name: '线材', shortage_qty: 8, suggest_purchase_qty: 8, uom: 'M' },
          ],
        },
      },
    };
    const recoverableRun = {
      run_id: 'run-terminal-gates',
      tracking_task_id: 'task-terminal-gates',
      mode: 'real' as const,
      status: 'blocked' as const,
      current_node: 'check_material_readiness',
      steps: [],
      results: staleResults,
      blocked_reason: { code: 'MISSING_AUTHORITY_FACTS', message: 'M3 material matching requires review' },
      error: null,
      result_summary: {},
    };
    useBusinessRunStore.setState({
      active: true,
      running: false,
      phase: 'blocked',
      title: '链路已安全阻断',
      detail: 'M3 material matching requires review',
      taskId: 'task-terminal-gates',
      runId: 'run-terminal-gates',
      run: recoverableRun,
    });
    renderWithApp(<DataFlowPanel />);

    expect(await screen.findByRole('button', { name: '采用最高匹配候选并继续' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agent 解析确认并继续' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '补货入账并继续' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '载入受控排程 fixture 并继续' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '人工匹配' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: '人工匹配' }));
    expect(await screen.findByRole('dialog', { name: 'M3 物料人工匹配' })).toBeInTheDocument();

    act(() => {
      useBusinessRunStore.setState({
        phase: 'human_input_required',
        title: '业务流程运行失败',
        detail: 'M1 M2 M5 governance UPSTREAM_BOM_NOT_APPROVED',
        run: { ...recoverableRun, status: 'failed' },
      });
    });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'M3 物料人工匹配' })).not.toBeInTheDocument());
    expect(screen.getAllByText('失败').length).toBeGreaterThan(0);
    for (const name of [
      /继续运行/,
      '确认订单信息并继续',
      'Agent 解析确认并继续',
      '审核通过，批准 BOM 并继续',
      '采用最高匹配候选并继续',
      '人工匹配',
      '补货入账并继续',
      '载入受控排程 fixture 并继续',
    ]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }

    act(() => {
      useBusinessRunStore.setState({
        phase: 'blocked',
        title: '业务流程已完成',
        run: { ...recoverableRun, status: 'completed' },
      });
    });
    expect((await screen.findAllByText('已完成')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /继续运行/ })).not.toBeInTheDocument();
    expect(calls.filter((call) => call.method !== 'GET')).toEqual([]);
  });

  it('当前运行停在人工 Gate 时不使用历史 trace 点亮 M4/M5', async () => {
    useBusinessRunStore.setState({
      active: true,
      running: false,
      phase: 'human_input_required',
      title: '流程等待人工确认',
      detail: 'M3 requires human input',
      trace,
      run: {
        run_id: 'run-current-gated',
        tracking_task_id: 'task-current-gated',
        mode: 'real',
        status: 'human_input_required',
        current_node: 'persist_trace',
        steps: [
          { node_name: 'resolve_order_from_m1', status: 'completed', module: 'm1' },
          { node_name: 'resolve_or_generate_bom', status: 'completed', module: 'm2' },
          { node_name: 'run_mrp', status: 'completed', module: 'm3' },
        ],
        results: {},
        blocked_reason: { code: 'HUMAN_INPUT_REQUIRED', message: 'M3 requires human input' },
        error: null,
        result_summary: {},
      },
    });
    renderWithApp(<DataFlowPanel />);

    const track = screen.getByLabelText('订单到排程 数据流动');
    const stageCards = track.querySelectorAll(`.${styles.stageCard}`);
    expect(stageCards[0]).toHaveClass(styles['is-ok']!);
    expect(stageCards[1]).toHaveClass(styles['is-ok']!);
    expect(stageCards[2]).toHaveClass(styles['is-ok']!);
    expect(stageCards[3]).toHaveClass(styles['is-data-only']!);
    expect(stageCards[4]).toHaveClass(styles['is-data-only']!);
    expect(screen.queryByText('1 条采购建议')).not.toBeInTheDocument();
    expect(screen.queryByText('排程 cp-demo')).not.toBeInTheDocument();
  });

  it('M2 门问题用醒目样式展示（需确认 Tag + 原因/默认浅黄块）', async () => {
    useBusinessRunStore.setState({
      active: true,
      running: false,
      phase: 'human_input_required',
      title: '流程等待人工补充',
      detail: 'M2 requires human input',
      taskId: 'task-m2-visual',
      run: {
        run_id: 'run-m2-visual',
        tracking_task_id: 'task-m2-visual',
        mode: 'real',
        status: 'human_input_required',
        current_node: 'persist_trace',
        steps: [],
        results: {
          m2: {
            result: {
              open_customer_questions: [
                {
                  question_id: 'q-visual-1',
                  field: 'history_reuse',
                  question: '请确认该历史 BOM 是否与当前产品同源',
                  reason: '历史表字段不能静默改变',
                  default_policy: '同源，按最小改动复用',
                  blocking: true,
                },
              ],
            },
          },
        },
        blocked_reason: { code: 'HUMAN_INPUT_REQUIRED', message: 'M2 requires human input' },
        error: null,
        result_summary: {},
      },
    });
    renderWithApp(<DataFlowPanel />);

    // 问题标题使用醒目类（gateQuestion）
    const question = screen.getByText('请确认该历史 BOM 是否与当前产品同源');
    expect(question).toHaveClass(styles.gateQuestion!);
    // blocking 问题带「需确认」Tag
    expect(screen.getByText('需确认')).toBeInTheDocument();
    // 原因与默认策略使用浅黄提示块（gateReasonBlock）
    expect(screen.getByText(/原因：历史表字段不能静默改变/)).toHaveClass(styles.gateReasonBlock!);
    expect(screen.getByText(/默认策略：同源，按最小改动复用/)).toHaveClass(styles.gateReasonBlock!);
  });

  it('M3 批准门显示黄色警告提示（未批准无法进入采购与排程）', async () => {
    useBusinessRunStore.setState({
      active: true,
      running: false,
      phase: 'human_input_required',
      title: '流程等待人工补充',
      detail: 'M3 governance review required: UPSTREAM_BOM_NOT_APPROVED_FOR_MRP',
      taskId: 'task-m3-visual',
      run: {
        run_id: 'run-m3-visual',
        tracking_task_id: 'task-m3-visual',
        mode: 'real',
        status: 'human_input_required',
        current_node: 'persist_trace',
        steps: [],
        results: {
          m2: {
            result: {
              bom_generation: {
                status: 'draft_pending_engineering_review',
                bom_system: { layer_order: [], generation_policy: {} },
                bom_lines: [
                  { component_item: 'CBL-01', component_name: '线材', qty_per: 1, uom: 'PCS', scrap_pct: 0.5, supply_type: 'BUY' },
                ],
              },
            },
          },
        },
        blocked_reason: { code: 'HUMAN_INPUT_REQUIRED', message: 'M3 governance review required' },
        error: null,
        result_summary: {},
      },
    });
    renderWithApp(<DataFlowPanel />);

    expect(screen.getByText('M3 上游 BOM 未批准，需人工审核')).toBeInTheDocument();
    // 黄色警告（antd Alert warning）
    expect(screen.getByText(/BOM 未批准将无法进入采购与排程/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '审核通过，批准 BOM 并继续' })).toBeInTheDocument();
  });
});
