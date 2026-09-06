import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

type TrackingEntity = {
  tenant_id?: string;
  entity_type?: string;
  module?: string;
  local_id?: string;
  business_id?: string;
  version_id?: string;
  status?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

type BusinessTrackingTestApi = {
  mergeEntities: (primary: TrackingEntity[], secondary: TrackingEntity[]) => TrackingEntity[];
  mergeSnapshots: (
    tracking: Record<string, unknown>,
    governed: Record<string, unknown>,
    taskId: string,
  ) => Record<string, unknown> & { entities: TrackingEntity[] };
  governedTraceSnapshot: (
    payload: Record<string, unknown>,
    taskId: string,
  ) => Record<string, unknown> & { entities: TrackingEntity[] };
};

const testGlobals = globalThis as typeof globalThis & {
  __businessTrackingTestApi?: BusinessTrackingTestApi;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  localStorage.clear();
  delete testGlobals.__businessTrackingTestApi;
});

async function renderDirectTask(options: {
  withM5: boolean;
  scheduleFails?: boolean;
  trackingDisabled?: boolean;
  sparseTracking?: boolean;
  trackingBindingsOnly?: boolean;
  governedM4Fails?: boolean;
  governedDataIncomplete?: boolean;
  m5ModuleStatus?: string;
  m5OverallStatus?: 'active' | 'complete' | 'attention';
  largeGovernedTrace?: boolean;
  executionSummary?: Record<string, unknown>;
}) {
  const html = await readFile('public/business.html', 'utf8');
  const body = html.match(/<body>([\s\S]*?)<script>/)?.[1];
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!body || !script) throw new Error('Expected Business page body and script');
  document.body.innerHTML = body;
  const trackingEntities = [
    { tenant_id: 'tenant-existing', entity_type: 'order', module: 'm1', business_id: 'SO-EXISTING', metadata: {} },
    {
      tenant_id: 'tenant-existing',
      entity_type: 'procurement_plan',
      module: 'm3',
      business_id: 'PLAN-EXISTING',
      version_id: 'PLAN-V1',
      metadata: {
        lines: [{
          material_code: 'MAT-EXISTING',
          material_name: '现有物料',
          gross_required_qty: 5,
          available_qty: 3,
          open_po_qty: 2,
          order_shortage_qty: 0,
          expected_available_date: '2026-07-28T08:00:00Z',
          readiness: 'covered_by_stock_or_open_po',
        }],
      },
    },
    {
      tenant_id: 'tenant-existing',
      entity_type: 'purchase_suggestion',
      module: 'm4',
      local_id: '17',
      business_id: 'MAT-EXISTING',
      status: 'valid',
      metadata: {
        item_code: 'MAT-EXISTING',
        item_name: '现有物料',
        quantity: 2,
        unit: 'PCS',
        required_date: '2026-07-28',
        supplier_name: '受控供应商',
      },
    },
    {
      tenant_id: 'tenant-existing',
      entity_type: 'purchase_order',
      module: 'm4',
      business_id: 'PO-EXISTING',
      metadata: {},
    },
  ];
  const snapshot = {
    task: { task_id: 'task-existing-1', tenant_id: 'tenant-existing', task_summary: '已有链路' },
    generated_at: '2026-07-27T00:00:00Z',
    diagnostics: { status: 'pass' },
    module_runs: options.sparseTracking
      ? options.governedM4Fails
        ? [{ module: 'm4', status: 'fail', event_count: 1, message: 'M4 import rejected' }]
        : []
      : ['m1', 'm2', 'm3', 'm4', ...(options.withM5 ? ['m5'] : [])].map((module) => ({
          module,
          status: module === 'm5' ? options.m5ModuleStatus ?? 'ok' : 'ok',
          event_count: 1,
          message: module === 'm5' && options.m5ModuleStatus === 'fail'
            ? 'M5 scheduling failed'
            : module === 'm5' && options.m5ModuleStatus === 'blocked'
              ? 'M5 authority facts require review'
              : undefined,
        })),
    entities: options.sparseTracking
      ? []
      : options.trackingBindingsOnly
        ? trackingEntities.map(({ module, ...entity }) => ({
            ...entity,
            bindings: [{ module, local_id: `${module}-local-${entity.business_id}` }],
          }))
        : trackingEntities,
    events: options.governedM4Fails
      ? [{ event_id: 'event-m4-failed', module: 'm4', event_type: 'tool_failed' }]
      : [],
  };
  const m5Flow = {
    plan_version: 'baseline-existing-1',
    tracking_task_id: 'task-existing-1',
    overall_status: options.m5OverallStatus ?? 'active',
    progress_percent: options.m5OverallStatus === 'complete' ? 100 : 20,
    input: { scenario_id: 'existing', order_count: 1, orders: [], routing_step_count: 2, resource_count: 3, material_availability_count: 1, bom_item_count: 1 },
    output: { solver_status: 'feasible', validation_passed: true, lifecycle_status: 'draft', scheduled_operation_count: 1, scheduled_order_count: 1, scheduled_resource_count: 1, dispatch_item_count: 0, dispatch_acknowledged_count: 0, execution_event_count: 0 },
    stages: [
      { key: 'input', label: 'Input persisted', status: 'succeeded', completed: 1, total: 1, message: 'schedule input is persisted' },
      { key: 'scheduling', label: 'Schedule generated', status: 'succeeded', completed: 1, total: 1, message: 'one operation persisted' },
      { key: 'validation', label: 'Schedule validated', status: 'succeeded', completed: 1, total: 1, message: 'hard constraints passed' },
      { key: 'approval', label: 'Plan approved', status: 'not_started', completed: 0, total: 1, message: 'draft plan' },
      { key: 'dispatch', label: 'Output acknowledged', status: 'not_started', completed: 0, total: 0, message: 'no dispatch' },
      { key: 'execution', label: 'Execution returned', status: 'not_started', completed: 0, total: 1, message: 'no execution events' },
    ],
    tracking: { tracking_task_id: 'task-existing-1', mode: 'shadow', event_count: 3, sent_count: 3, pending_count: 0, retry_count: 0, processing_count: 0, dead_letter_count: 0 },
    jobs: [],
  };
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === '/historical-order-catalog.json') return Response.json([]);
    if (url === '/run-config/candidate-run-manifest.json') return Response.json([]);
    if (url === '/api/auth/me') return new Response('', { status: 404 });
    if (url.startsWith('/api/orchestrator/tracking/tasks/task-existing-1/snapshot')) {
      return options.trackingDisabled
        ? Response.json({ detail: 'TaskID tracking is disabled' }, { status: 503 })
        : Response.json(snapshot);
    }
    if (url === '/api/orchestrator/business-tasks/task-existing-1/trace') {
      return Response.json({
        flow: {
          run_id: 'flow-existing-1', tracking_task_id: 'task-existing-1',
          requested_order_id: 'SO-EXISTING', order_id: 'SO-EXISTING', mode: 'pressure_only',
          status: options.governedDataIncomplete ? 'data_incomplete' : options.governedM4Fails ? 'failed' : 'completed',
          current_node: options.governedDataIncomplete ? 'solve_schedule' : options.governedM4Fails ? 'create_or_update_purchase_orders' : 'persist_trace',
          updated_at: '2026-07-27T00:00:00Z',
          blocked_reason: options.governedDataIncomplete
            ? { code: 'MISSING_AUTHORITY_FACTS', message: '缺少已审核的 M5 产能事实' }
            : null,
          steps: [
            { module: 'm1', node_name: 'resolve_order_from_m1', status: 'completed' },
            { module: 'm2', node_name: 'resolve_or_generate_bom', status: 'completed' },
            { module: 'm3', node_name: 'persist_procurement_plan', status: 'completed' },
            options.governedM4Fails
              ? { module: 'm4', node_name: 'create_or_update_purchase_orders', status: 'failed', error: 'M4 import rejected' }
              : { module: 'm4', node_name: 'create_or_update_purchase_orders', status: 'completed' },
          ],
        },
        trace: {
          tenant_id: 'tenant-existing', order_id: 'SO-EXISTING',
          order: { order_id: 'SO-EXISTING', order_number: 'SO-EXISTING', lifecycle_status: 'active', attributes: { product_name: '现有产品', order_quantity: 5, bom_id: 'BOM-EXISTING' } },
          materials: [{ material_id: 'mat-existing', material_code: 'MAT-EXISTING', name: '现有物料', unit: 'PCS' }],
          order_materials: [{ line_id: 'om-existing', material_id: 'mat-existing', bom_version: 'BOM-EXISTING', quantity: 5, unit: 'PCS', source_line_id: 'BOML-1', attributes: { qty_per: 1 } }],
          inventory_balances: [{ balance_id: 'bal-existing', material_id: 'mat-existing', quantity_available: 3 }],
          inventory_movements: options.largeGovernedTrace
            ? Array.from({ length: 10_000 }, (_, index) => ({
                movement_id: `movement-${index}`,
                sequence: index,
                payload: 'x'.repeat(600),
              }))
            : [],
          procurement_plans: [{
            plan_id: 'PLAN-EXISTING',
            version: 1,
            status: 'calculated',
            summary: { source_plan_id: 'PLAN-EXISTING', source_version: 'PLAN-V1' },
          }],
          procurement_plan_lines: [{ line_id: 'pl-existing', plan_id: 'PLAN-EXISTING', material_id: 'mat-existing', demand_quantity: 5, on_hand_quantity: 3, open_po_quantity: 0, shortage_quantity: 2, recommended_quantity: 2, status: 'shortage', calculation: { net_required_qty: 2, readiness: 'shortage' } }],
          purchase_orders: options.governedM4Fails
            ? []
            : [{
                purchase_order_id: 'po-existing',
                purchase_order_number: 'PO-EXISTING',
                order_id: 'SO-EXISTING',
                plan_line_id: 'pl-existing',
                material_id: 'mat-existing',
                ordered_quantity: 2,
                received_quantity: 0,
                status: 'draft',
                source_module: 'm4',
                attributes: {
                  source_purchase_order_id: 'm4-po-existing',
                  source_item_id: 'm4-item-existing',
                  supplier_name: '受控供应商',
                },
              }],
          schedule_versions: options.withM5 ? [{ schedule_id: 'schedule-existing', source_schedule_id: 'baseline-existing-1', scenario_type: 'pressure_only', status: 'solved' }] : [],
          business_flow_runs: [],
        },
      });
    }
    if (url.startsWith('/api/m5/ops/flow-dashboard?tracking_task_id=task-existing-1')) {
      return Response.json({ success: true, data: options.withM5 ? [m5Flow] : [], errors: [] });
    }
    if (url === '/api/m5/schedules/baseline-existing-1') {
      if (options.scheduleFails) return new Response('Unavailable', { status: 503 });
      return Response.json({
        success: true,
        data: {
          plan_version: 'baseline-existing-1',
          operations: [{ order_id: 'SO-EXISTING', operation_id: 'OP-1', operation_name: 'cutting', resource_id: 'EQ-01', start_time: '2026-07-27T08:00:00Z', end_time: '2026-07-27T09:00:00Z', status: 'scheduled' }],
          order_kitting: [{
            order_id: 'SO-EXISTING',
            earliest_kitting_time: '2026-07-28T08:00:00Z',
            status: 'ready',
            missing_materials: [],
            calculated_at: '2026-07-27T07:00:00Z',
            source: 'mrp',
            allocations: [{ material_id: 'MAT-EXISTING', supply_material_id: 'MAT-EXISTING', quantity: 5, primary_equivalent_quantity: 5, available_time: '2026-07-28T08:00:00Z', supply_type: 'inventory', warehouse_id: 'WH-01', batch_id: 'BATCH-01', is_substitute: false }],
          }],
        },
        errors: [],
      });
    }
    if (url === '/api/m5/schedules/baseline-existing-1/execution-summary') {
      return Response.json(options.executionSummary ?? {
        plan_version: 'baseline-existing-1',
        event_count: 2,
        latest_event_at: '2026-07-28T09:00:00Z',
        late_operation_count: 1,
        exception_count: 0,
        scrap_quantity: 0,
        planned_operation_count: 1,
        started_operation_count: 1,
        completed_operation_count: 1,
        paused_operation_count: 0,
        exception_operation_count: 0,
        completion_rate_percent: 100,
        source_event_counts: { mes: 2 },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));
  window.history.pushState({}, '', '/business.html?task_id=task-existing-1&module=m5');
  new Function(`${script}\n;globalThis.__businessTrackingTestApi={mergeEntities,mergeSnapshots,governedTraceSnapshot};`)();
  await vi.waitFor(() =>
    expect(
      document.querySelectorAll('.pipeline .step'),
      document.querySelector('#message')?.textContent || document.body.textContent || '',
    ).toHaveLength(5),
  );
  if (!testGlobals.__businessTrackingTestApi) {
    throw new Error('Expected business tracking test API');
  }
  return testGlobals.__businessTrackingTestApi;
}

describe('business tracking static page', () => {
  it('ships the human-readable tracking page with the production frontend', async () => {
    const html = await readFile('public/business.html', 'utf8');

    expect(html).toContain('<h1>订单全链路</h1>');
    expect(html).toContain('/api/orchestrator/tracking/tasks/');
    expect(html).toContain('输入正式业务链路的 Tracking TaskID');
    expect(html).not.toContain('task_demo_hist_001_d6c8fa5c69de');
    // 静态产物不得泄漏内网地址（含任意私网 IP 字面量）
    expect(html).not.toMatch(/\b(192\.168|10\.\d{1,3}|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/);
    expect(html).toContain('class="catalog-run"');
    expect(html).toContain('运行 订单到排程');
    expect(html).toContain('method:"POST"');
    expect(html).toContain('"/api/orchestrator/business-flows"');
    expect(html).toContain('/api/orchestrator/business-flows/');
    expect(html).toContain('/api/orchestrator/business-orders/');
    expect(html).toContain('/api/orchestrator/business-tasks/');
    expect(html).toContain('function governedTraceSnapshot');
    expect(html).toContain('String(tenant),String(value.entity_type),String(id),String(version)');
    expect(html).toContain('/api/auth/session/anonymous');
    expect(html).toContain('headers["X-CSRF-Token"]=csrfToken');
    expect(html).toContain('if(unsafe)await ensureBrowserSession()');
    expect(html).toContain('headers.set("X-CSRF-Token",csrfToken)');
    expect(html).toContain('allowRecovery&&unsafe&&[401,403].includes(response.status)');
    expect(html).toContain('return jsonRequest(url,{...options,headers:retryHeaders},false)');
    expect(html).toContain('globalThis.crypto?.subtle');
    expect(html).toContain('return sha256HexSync(bytes)');
    expect(html).toContain('if(me.status===404){csrfToken="";return}');
    expect(html).toContain('if(config.auth_mode!=="shared_anonymous"||!config.capabilities?.anonymous_session)');
    expect(html).toContain('原历史 TaskID 不在当前正式 Tracking 库中，请重新运行该订单生成新链路。');
    expect(html).toContain('if(tracking&&governed){render(mergeSnapshots(tracking,governed,id),m5State);return}');
    expect(html).toContain('contentType.includes("application/json")');
    expect(html).toContain('/run-config/candidate-run-manifest.json');
    expect(html).toContain('requestedCatalogId=pageParams.get("catalog_id")');
    expect(html).toContain('requestedAction=pageParams.get("action")||"view"');
    expect(html).toContain('requestedModule=/^m[1-5]$/.test');
    expect(html).toContain('nextUrl.searchParams.set("action","view")');
    expect(html).toContain('showModule(requestedModule,s,m5State)');
    expect(html).toContain('物料匹配与人工核验');
    expect(html).toContain('function openM3Matching');
    expect(html).toContain('/api/m3/procurement-plan:run-json?use_m3_supply=true&allow_agent_estimates=false&use_demo_supplements=false');
    expect(html).toContain('<pre>${esc(boundedJsonText(body))}</pre>');
    expect(html).not.toContain('JSON.stringify(body,null,2)');
    expect(html).toContain('确认并应用到页面');
    expect(html).toContain('导出核验标签');
    expect(html).toContain('tracking_task_id');
    expect(html).toContain('idempotency_key:runKey');
    expect(html).toContain('"X-Yunpai-Task-ID":trackingTaskId');
    expect(html).toContain('m5_payload:config.m5_payload||null');
    expect(html).toContain('replace_m3_bom_with_m2:true');
    expect(html).toContain('flow.status==="human_input_required"||flow.status==="blocked"');
    expect(html).toContain('await waitForM5Flow(trackingTaskId,planVersion)');
    expect(html).not.toContain('"/api/orchestrator/invoke"');
    // 受控排程 fixture 由服务端构建：前端只 resume 传 fixture 标记，
    // orchestrator solve_schedule 消费标记并构建受控演示载荷（_build_demo_m5_payload）；
    // 禁止前端直调 M5 求解器（/api/m5/schedule-candidates）回归。
    expect(html).not.toContain('"/api/m5/schedule-candidates"');
    expect(html).toContain('fixture:"standard-4station"');
    expect(html).toContain('scenario_purpose:scenarioPurpose');
    expect(html).not.toContain('模拟切割设备');
    expect(html).not.toContain('use_demo_sources:true');
    expect(html).toContain('throw Error(`Tracking 快照缺少模块事件：${missing.join("、")}`)');
    expect(html).toContain('/api/m5/ops/flow-dashboard?tracking_task_id=');
    expect(html).toContain('/api/m5/schedules/');
    expect(html).toContain('/execution-summary');
    expect(html).toContain('execution:null,executionError:""');
    expect(html).toContain('showM5Module(s,m5State)');
    expect(html).toContain('物料就绪快照');
    expect(html).toContain('M3 物料行齐套率');
    expect(html).toContain('M3 可用库存（传入 M5）');
    expect(html).toContain('M3 在途采购和 M4 采购建议均不是已确认的 M5 到货');
    expect(html).toContain('现场工序完成');
    expect(html).toContain('source_event_counts');
    expect(html).toContain('不能将执行事件数、排程流程进度或计划生命周期当作生产完成率');
    expect(html).toContain('排程流程进度');
    expect(html).toContain('人员级安排尚无数据');
    expect(html).toContain('当前为压力测试排程，未进入生产发布');
    expect(html).not.toContain('打开完整 M5 看板');
    expect(html).toContain('bridgeM2BomLines');
    expect(html).toContain('config.order?.bom_excel_path||config.history_bom_path');
    expect(html).toContain('material_code:materialCode');
    expect(html).toContain('function selectProcurementPlan');
    expect(html).toContain('function findM3Lines');
    expect(html).toContain('isModuleEntity(entity,"m3")&&entity.metadata?.lines?.length');
    expect(html).toContain('plans.find(entity=>entity.metadata?.lines?.length)');
    expect(html).toContain('entity?.metadata?.bom_lines?.length');
    expect(html).toContain('jobEvidence.get(s.task.task_id)?.m2?.output');
    expect(html).toContain('displayBomLines=bomLines.length?bomLines:normalizeBomLines(m3Lines)');
    expect(html).toContain('metric("历史 BOM 物料",displayBomLines.length)');
    expect(html).toContain('metric("订单数量",orderQty)');
    expect(html).toContain('在线预览原始文件');
    expect(html).toContain('extension==="csv"');
    expect(html).toContain('["pdf"].includes(extension)');
    expect(html).toContain('["png","jpg","jpeg","gif","webp","bmp"].includes(extension)');
    expect(html).toContain('该 Office 原件暂不支持浏览器内原样渲染');
    expect(html).not.toContain('/tracking/events');
    expect(html).not.toContain('/tracking/tasks",{method:"POST"');

    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
  });

  it('submits one governed 订单到排程 flow and reads persisted M5 evidence with one root TaskID', async () => {
    const html = await readFile('public/business.html', 'utf8');
    const body = html.match(/<body>([\s\S]*?)<script>/)?.[1];
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(body).toBeTruthy();
    expect(script).toBeTruthy();
    document.body.innerHTML = body!;

    const catalog = [{
      catalog_id: 'catalog-1',
      status: '待运行',
      order_id: 'SO-1',
      product_name: '测试产品',
      source_file: 'order.csv',
      source_sheet: 'Sheet1',
      bom_lines: 1,
      data_status: '可执行',
    }];
    const runConfig = [{
      catalog_id: 'catalog-1',
      product_code: 'FG-1',
      order_url: '/uploads/order.csv',
      order_filename: 'order.csv',
      history_bom_path: '/demo-data/old.xlsx',
      m3_input_url: '/run-config/input.json',
      order: {
        order_id: 'SO-1',
        order_qty: 2,
        due_date: '2026-08-01',
        bom_excel_path: '/srv/yunpai-business-tracking/history-bom/current.xlsx',
      },
      mode: 'pressure_only',
      m5_payload: {
        scenario_id: 'governed-pressure-input-1',
        scenario_purpose: 'pressure_only',
        orders: [{ order_id: 'SO-1', product_id: 'FG-1', quantity: 2 }],
        routing_steps: [{ operation_id: 'OP-CUT', product_id: 'FG-1' }],
        resources: [{ resource_id: 'EQ-GOVERNED-1' }],
      },
    }];
    const m2Lines = [{
      component_item: 'MAT-1',
      component_name: '物料一',
      qty_per: 2,
      uom: 'PCS',
      supply_type: 'BUY',
    }];
    const m3Input = {
      order: { order_id: 'SO-1', project_id: 'PRJ-1', bom_id: 'BOM-1', order_qty: 2 },
      bom: { lines: [{ material_code: 'MAT-1', material_name: '物料一', qty_per: 2, uom: 'PCS' }] },
      inventory_snapshot: [],
      open_purchase_orders: [],
    };
    const m3Lines = [{
      material_code: 'MAT-1',
      material_name: '物料一',
      order_qty: 2,
      gross_required_qty: 4,
      available_qty: 1.5,
      open_po_qty: 2,
      order_shortage_qty: 2.5,
      expected_available_date: '2026-07-31T08:00:00Z',
      readiness: 'shortage',
    }];
    const flowRequests: Array<{ body: Record<string, unknown>; headers: Headers }> = [];
    let rootTaskId = '';
    const m5Operations = [
      { order_id: 'SO-1', operation_id: 'OP-CUT', operation_name: 'cutting', resource_id: 'EQ-01', start_time: '2026-07-27T08:00:00Z', end_time: '2026-07-27T09:00:00Z', status: 'scheduled' },
      { order_id: 'SO-2', operation_id: 'OP-CUT', operation_name: 'cutting', resource_id: 'EQ-02', start_time: '2026-07-27T08:00:00Z', end_time: '2026-07-27T09:00:00Z', status: 'scheduled' },
      { order_id: 'SO-1', operation_id: 'OP-ASSEMBLE', operation_name: 'assembly', resource_id: 'EQ-03', start_time: '2026-07-27T09:00:00Z', end_time: '2026-07-27T10:30:00Z', status: 'scheduled' },
      { order_id: 'SO-2', operation_id: 'OP-ASSEMBLE', operation_name: 'assembly', resource_id: 'EQ-03', start_time: '2026-07-27T10:30:00Z', end_time: '2026-07-27T12:00:00Z', status: 'scheduled' },
    ];
    const m5Flow = {
      plan_version: 'baseline-test-1',
      tracking_task_id: 'task-root-1',
      progress_percent: 0,
      input: {
        scenario_id: 'business-catalog-1',
        scenario_purpose: 'pressure_only',
        order_count: 1,
        orders: [{ order_id: 'SO-1', product_id: 'FG-1', quantity: 2, unit: 'pcs' }],
        routing_step_count: 2,
        resource_count: 3,
        material_availability_count: 1,
        bom_item_count: 1,
      },
      output: {
        solver_status: 'feasible',
        validation_passed: true,
        lifecycle_status: 'draft',
        scheduled_operation_count: 4,
        scheduled_order_count: 2,
        scheduled_resource_count: 3,
        dispatch_item_count: 0,
        dispatch_acknowledged_count: 0,
        execution_event_count: 0,
      },
      stages: [
        { key: 'input', label: 'Input persisted', status: 'succeeded', completed: 1, total: 1, message: 'schedule input is persisted' },
        { key: 'scheduling', label: 'Schedule generated', status: 'succeeded', completed: 4, total: 4, message: 'four operations persisted' },
        { key: 'validation', label: 'Schedule validated', status: 'succeeded', completed: 1, total: 1, message: 'hard constraints passed' },
        { key: 'approval', label: 'Plan approved', status: 'not_started', completed: 0, total: 1, message: 'draft plan' },
        { key: 'dispatch', label: 'Output acknowledged', status: 'not_started', completed: 0, total: 0, message: 'no dispatch' },
        { key: 'execution', label: 'Execution returned', status: 'not_started', completed: 0, total: 2, message: 'no execution events' },
      ],
      tracking: { tracking_task_id: 'task-root-1', mode: 'shadow', event_count: 3, sent_count: 3, pending_count: 0, retry_count: 0, processing_count: 0, dead_letter_count: 0 },
      jobs: [],
    };
    const snapshot = {
      task: { task_id: 'task-root-1', task_summary: '测试链路' },
      generated_at: '2026-07-27T00:00:00Z',
      diagnostics: { status: 'ok' },
      module_runs: ['m1', 'm2', 'm3', 'm4', 'm5'].map((module) => ({ module, status: 'ok', event_count: 1 })),
      entities: [
        { entity_type: 'order', module: 'm1', business_id: 'SO-1', metadata: {} },
        { entity_type: 'bom', module: 'm2', business_id: 'BOM-1', metadata: { bom_lines: m2Lines } },
        {
          entity_type: 'procurement_plan',
          module: 'm3',
          business_id: 'PLAN-1',
          metadata: { lines: m3Lines },
        },
        { entity_type: 'purchase_suggestion', module: 'm4', business_id: 'SUG-1', metadata: {} },
      ],
      events: [],
    };

    vi.stubGlobal('crypto', {});
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === '/historical-order-catalog.json') return Response.json(catalog);
      if (url === '/run-config/candidate-run-manifest.json') return Response.json(runConfig);
      if (url === '/uploads/order.csv') {
        return {
          ok: true,
          blob: async () => ({
            type: 'text/csv',
            arrayBuffer: async () => new TextEncoder().encode('order_id,quantity\nSO-1,2').buffer,
          }),
        } as Response;
      }
      if (url === '/run-config/input.json') return Response.json(m3Input);
      if (url.startsWith('/api/m3/procurement-plan:run-json?')) {
        return Response.json({
          success: true,
          data: { lines: [], shortage_lines: [] },
          material_matching: [],
          debug_records: Array.from({ length: 10_000 }, (_, index) => ({
            record_id: `m3-debug-${index}`,
            payload: 'x'.repeat(600),
          })),
        });
      }
      if (url === '/api/auth/me') {
        return Response.json({ session: { csrf_token: 'csrf-existing-session' } });
      }
      if (url === '/api/orchestrator/business-flows') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const headers = new Headers(init?.headers);
        rootTaskId = headers.get('X-Yunpai-Task-ID') ?? '';
        flowRequests.push({ body, headers });
        return Response.json({
          run_id: 'FLOW-1',
          tracking_task_id: rootTaskId,
          order_id: 'SO-1',
          mode: 'pressure_only',
          status: 'queued',
          current_node: 'intake',
        });
      }
      if (url === '/api/orchestrator/business-flows/FLOW-1') {
        return Response.json({
          run_id: 'FLOW-1',
          tracking_task_id: rootTaskId,
          requested_order_id: 'SO-1',
          order_id: 'SO-1',
          mode: 'pressure_only',
          status: 'completed',
          current_node: 'persist_trace',
          steps: [
            { tool: 'ingest_document', module: 'm1', status: 'completed', result: { status: 'completed' } },
            {
              tool: 'run_bom_sop_workflow',
              module: 'm2',
              status: 'completed',
              result: { result: { run_id: 'm2-run-1', bom_generation: { standard_bom: { bom_lines: m2Lines } } } },
            },
            { tool: 'run_mrp_procurement_plan', module: 'm3', status: 'completed', result: { procurement_plan_id: 'PLAN-1', lines: m3Lines } },
            { tool: 'export_m3_procurement_suggestions', module: 'm3', status: 'completed', result: { suggestions: [{ item_code: 'MAT-1', quantity: 4 }] } },
            { tool: 'import_m4_purchase_suggestions_json', module: 'm4', status: 'completed', result: { id: 'BATCH-1', valid_rows: 1 } },
            { tool: 'solve_scheduling', module: 'm5', status: 'completed', result: { schedule: { plan_version: 'baseline-test-1', operations: m5Operations } } },
          ],
        });
      }
      if (url === '/api/orchestrator/business-orders/SO-1/trace') {
        return Response.json({
          tenant_id: 'tenant-1',
          order_id: 'SO-1',
          order: { order_id: 'SO-1' },
          materials: [{ material_id: 'MAT-1' }],
          order_materials: [{ line_id: 'LINE-1' }],
          inventory_balances: [{ balance_id: 'BAL-1' }],
          inventory_movements: [],
          procurement_plans: [{ plan_id: 'PLAN-1' }],
          procurement_plan_lines: [{ line_id: 'PLAN-LINE-1' }],
          purchase_orders: [{ purchase_order_id: 'PO-1' }],
          schedule_versions: [{ schedule_id: 'SCHEDULE-1', source_schedule_id: 'baseline-test-1' }],
          business_flow_runs: [{ run_id: 'FLOW-1' }],
        });
      }
      if (url.startsWith(`/api/m5/ops/flow-dashboard?tracking_task_id=${rootTaskId}`)) {
        return Response.json({
          success: true,
          data: [{
            ...m5Flow,
            tracking_task_id: rootTaskId,
            tracking: { ...m5Flow.tracking, tracking_task_id: rootTaskId },
          }],
          errors: [],
        });
      }
      if (url === '/api/m5/schedules/baseline-test-1') {
        return Response.json({
          success: true,
          data: {
            plan_version: 'baseline-test-1',
            operations: m5Operations,
            order_kitting: [{
              order_id: 'SO-1',
              earliest_kitting_time: '2026-07-31T08:00:00Z',
              status: 'shortage',
              missing_materials: ['MAT-1'],
              calculated_at: '2026-07-27T07:00:00Z',
              source: 'mrp',
              allocations: [{ material_id: 'MAT-1', supply_material_id: 'MAT-1', quantity: 1.5, primary_equivalent_quantity: 1.5, available_time: '2026-07-27T08:00:00Z', supply_type: 'inventory', warehouse_id: 'WH-01', batch_id: 'BATCH-01', is_substitute: false }],
            }],
          },
          errors: [],
        });
      }
      if (url === '/api/m5/schedules/baseline-test-1/execution-summary') {
        return Response.json({
          plan_version: 'baseline-test-1',
          event_count: 0,
          latest_event_at: null,
          late_operation_count: 0,
          exception_count: 0,
          scrap_quantity: 0,
          planned_operation_count: 4,
          started_operation_count: 0,
          completed_operation_count: 0,
          paused_operation_count: 0,
          exception_operation_count: 0,
          completion_rate_percent: null,
          source_event_counts: {},
        });
      }
      if (url.startsWith(`/api/orchestrator/tracking/tasks/${rootTaskId}/snapshot`)) {
        return Response.json({ ...snapshot, task: { ...snapshot.task, task_id: rootTaskId } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    window.history.pushState({}, '', '/business.html?catalog_id=catalog-1&action=run&module=m3');
    new Function(script!)();
    await vi.waitFor(() => expect(flowRequests, document.body.textContent || '').toHaveLength(1));
    const rootRequest = flowRequests[0];
    if (!rootRequest) throw new Error('Expected one root business-flow request');

    expect(rootTaskId).toMatch(/^task_[0-9a-f]{32}$/);
    expect(rootRequest.headers.get('X-Yunpai-Task-ID')).toBe(rootTaskId);
    expect(rootRequest.headers.get('X-CSRF-Token')).toBe('csrf-existing-session');
    expect(rootRequest.body).toMatchObject({
      order_id: 'SO-1',
      mode: 'pressure_only',
      m3_payload: m3Input,
      replace_m3_bom_with_m2: true,
      m5_payload: runConfig[0]?.m5_payload,
    });
    expect(rootRequest.body.m2_payload).toMatchObject({
      use_demo_sources: false,
      history_bom_paths: ['/srv/yunpai-business-tracking/history-bom/current.xlsx'],
    });
    expect(rootRequest.body.idempotency_key).toMatch(/^business:catalog-1:[0-9a-f]{64}$/);
    await vi.waitFor(() => expect(document.body.textContent).toContain('M5 · 生产排程'));
    expect(document.querySelectorAll('.pipeline .step')).toHaveLength(5);
    expect(document.querySelector('.step.selected')?.getAttribute('data-module')).toBe('m3');
    (document.querySelector('.module-tab[data-view="matching"]') as HTMLElement).click();
    await vi.waitFor(() => expect(document.querySelector('#m3-module-body .raw pre')).not.toBeNull());
    const m3Raw = document.querySelector<HTMLElement>('#m3-module-body .raw pre')?.textContent ?? '';
    expect(m3Raw).toContain('m3-debug-0');
    expect(m3Raw).not.toContain('m3-debug-100');
    expect(m3Raw).toContain('"__truncated_items__": 9950');
    expect(m3Raw.length).toBeLessThan(100_000);
    expect(document.querySelector('#m3-module-body .raw summary')?.textContent).toContain('有界摘要');
    const search = document.querySelector<HTMLInputElement>('#catalog-search');
    if (!search) throw new Error('Expected catalog search');
    search.value = 'not-a-real-order';
    search.dispatchEvent(new Event('input'));
    expect(document.querySelector('#sample-catalog-body')?.textContent).toContain('没有符合条件的历史订单');
    search.value = '';
    search.dispatchEvent(new Event('input'));
    expect(document.querySelectorAll('#sample-catalog-body tbody tr')).toHaveLength(1);
    (document.querySelector('[data-module="m5"]') as HTMLElement).click();
    expect(document.body.textContent).toContain('当前为压力测试排程，未进入生产发布');
    expect(document.querySelectorAll('.m5-gantt-lane')).toHaveLength(3);
    expect(document.querySelectorAll('.m5-gantt-bar')).toHaveLength(4);
    expect(document.body.textContent).toContain('人员级安排尚无数据');
  });

  it('falls back to the governed business trace when legacy Tracking is disabled', async () => {
    await renderDirectTask({ withM5: false, trackingDisabled: true });

    expect(document.body.textContent).toContain('SO-EXISTING');
    expect(document.body.textContent).toContain('现有物料');
    expect(document.body.textContent).toContain('M4 · 采购建议入库');
    expect(document.querySelector<HTMLElement>('.step[data-module="m4"]')?.textContent).toContain('1 张采购单已持久化');
    expect(document.body.textContent).toContain('PO-EXISTING');
    expect(document.body.textContent).toContain('已持久化采购单');
    expect(document.body.textContent).not.toContain('读取失败');
  });

  it('merges a sparse 200 Tracking snapshot with persisted M1-M3 evidence and an M4 failure', async () => {
    await renderDirectTask({
      withM5: false,
      sparseTracking: true,
      governedM4Fails: true,
    });

    const m1 = document.querySelector<HTMLElement>('.step[data-module="m1"]');
    const m2 = document.querySelector<HTMLElement>('.step[data-module="m2"]');
    const m3 = document.querySelector<HTMLElement>('.step[data-module="m3"]');
    const m4 = document.querySelector<HTMLElement>('.step[data-module="m4"]');
    expect(m1?.textContent).toContain('订单文件已识别');
    expect(m2?.textContent).toContain('BOM-EXISTING');
    expect(m3?.textContent).toContain('1 种物料');
    expect(m4?.textContent).toContain('M4 执行失败');
    expect(m4?.textContent).toContain('M4 import rejected');
    expect(m4?.querySelector('.chip')?.textContent).toBe('执行失败');
    expect(document.querySelector('.hero .status')?.textContent).toBe('存在待核对项');
    expect(document.body.textContent).not.toContain('governed-bom');
  });

  it('deduplicates same-tenant Tracking entities whose module is carried only by bindings', async () => {
    await renderDirectTask({ withM5: false, trackingBindingsOnly: true });

    const m4 = document.querySelector<HTMLElement>('.step[data-module="m4"]');
    const purchaseMetric = Array.from(document.querySelectorAll<HTMLElement>('.metrics .metric'))
      .find((item) => item.textContent?.includes('采购建议'));
    const purchasePanel = Array.from(document.querySelectorAll<HTMLElement>('.overview-only .panel'))
      .find((item) => item.querySelector('h3')?.textContent === 'M4 采购建议');
    expect(m4?.textContent).toContain('1 条有效采购建议');
    expect(purchaseMetric?.querySelector('b')?.textContent).toBe('1');
    expect(purchasePanel?.textContent).toContain('受控供应商');
    const purchaseTables = purchasePanel?.querySelectorAll('tbody');
    expect(purchaseTables).toHaveLength(2);
    expect(purchaseTables?.[0]?.querySelectorAll('tr')).toHaveLength(1);
    expect(purchaseTables?.[1]?.querySelectorAll('tr')).toHaveLength(1);
  });

  it('merges production identities without folding distinct plans, tenants, or purchase orders', async () => {
    const api = await renderDirectTask({ withM5: false });
    const governed = api.governedTraceSnapshot({
      flow: { run_id: 'flow-identity', status: 'completed', steps: [] },
      trace: {
        tenant_id: 'tenant-a',
        order_id: 'SO-IDENTITY',
        order: { order_id: 'SO-IDENTITY', attributes: {} },
        materials: [
          { material_id: 'mat-a', material_code: 'MAT-A', name: '物料 A', unit: 'PCS' },
          { material_id: 'mat-b', material_code: 'MAT-B', name: '物料 B', unit: 'PCS' },
        ],
        order_materials: [],
        inventory_balances: [],
        procurement_plans: [{
          plan_id: 'governed-plan-row',
          version: 1,
          status: 'calculated',
          summary: { source_plan_id: 'PLAN-A', source_version: 'PLAN-A-V1' },
        }],
        procurement_plan_lines: [],
        purchase_orders: [
          { purchase_order_id: 'po-line-1', purchase_order_number: 'PO-A', order_id: 'SO-IDENTITY', plan_line_id: 'plan-line-a', material_id: 'mat-a', ordered_quantity: 2, received_quantity: 0, status: 'draft', source_module: 'm4', attributes: { source_purchase_order_id: 'm4-po-a', source_item_id: 'm4-item-a1', supplier_name: '供应商甲' } },
          { purchase_order_id: 'po-line-2', purchase_order_number: 'PO-A', order_id: 'SO-IDENTITY', plan_line_id: 'plan-line-b', material_id: 'mat-b', ordered_quantity: 3, received_quantity: 1, status: 'draft', source_module: 'm4', attributes: { source_purchase_order_id: 'm4-po-a', source_item_id: 'm4-item-a2', supplier_name: '供应商甲' } },
          { purchase_order_id: 'po-line-3', purchase_order_number: 'PO-B', order_id: 'SO-IDENTITY', plan_line_id: 'plan-line-a', material_id: 'mat-a', ordered_quantity: 4, received_quantity: 0, status: 'draft', source_module: 'm4', attributes: { source_purchase_order_id: 'm4-po-b', source_item_id: 'm4-item-b1', supplier_name: '供应商乙' } },
          { purchase_order_id: 'po-line-4', purchase_order_number: null, order_id: 'SO-IDENTITY', plan_line_id: 'plan-line-b', material_id: 'mat-b', ordered_quantity: 1, received_quantity: 0, status: 'draft', source_module: 'm4', attributes: { source_purchase_order_id: 'm4-po-c', source_item_id: 'm4-item-c1', supplier_name: '供应商丙' } },
          { purchase_order_id: 'po-line-5', purchase_order_number: null, order_id: 'SO-IDENTITY', plan_line_id: 'plan-line-a', material_id: 'mat-a', ordered_quantity: 1, received_quantity: 0, status: 'draft', source_module: 'm4', attributes: { source_item_id: 'm4-item-d1', supplier_name: '供应商丁' } },
        ],
        schedule_versions: [],
      },
    }, 'task-identity');
    const tracking = {
      task: { task_id: 'task-identity', tenant_id: 'tenant-a' },
      diagnostics: { status: 'pass' },
      module_runs: [],
      events: [],
      entities: [
        { tenant_id: 'tenant-a', entity_type: 'procurement_plan', business_id: 'PLAN-A', version_id: 'PLAN-A-V1', metadata: {} },
        { tenant_id: 'tenant-a', entity_type: 'purchase_suggestion', business_id: 'MAT-A', local_id: '11', metadata: { item_code: 'MAT-A' } },
        { tenant_id: 'tenant-a', entity_type: 'purchase_order', business_id: 'PO-A', metadata: {} },
        { tenant_id: 'tenant-a', entity_type: 'purchase_order', business_id: 'PO-B', metadata: {} },
      ],
    };

    const merged = api.mergeSnapshots(tracking, governed, 'task-identity');
    const plans = merged.entities.filter((entity) => entity.entity_type === 'procurement_plan');
    const suggestions = merged.entities.filter((entity) => entity.entity_type === 'purchase_suggestion');
    const purchaseOrders = merged.entities.filter((entity) => entity.entity_type === 'purchase_order');
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ business_id: 'PLAN-A', version_id: 'PLAN-A-V1', tenant_id: 'tenant-a' });
    expect(suggestions).toHaveLength(1);
    expect(purchaseOrders).toHaveLength(4);
    const firstOrderItemsValue = purchaseOrders.find((entity) => entity.business_id === 'PO-A')?.metadata?.items;
    const firstOrderItems = Array.isArray(firstOrderItemsValue) ? firstOrderItemsValue : [];
    expect(firstOrderItems).toHaveLength(2);
    expect(firstOrderItems[0]).toMatchObject({
      purchase_order_line_id: 'po-line-1',
      order_id: 'SO-IDENTITY',
      plan_line_id: 'plan-line-a',
      material_id: 'mat-a',
      source_module: 'm4',
      source_purchase_order_id: 'm4-po-a',
      source_item_id: 'm4-item-a1',
    });
    expect(purchaseOrders.find((entity) => entity.business_id === 'PO-B')?.metadata?.items).toHaveLength(1);
    expect(purchaseOrders.find((entity) => entity.business_id === 'm4-po-c')?.metadata).toMatchObject({
      purchase_order_number: null,
      source_purchase_order_id: 'm4-po-c',
    });
    expect(purchaseOrders.find((entity) => entity.business_id === 'po-line-5')?.metadata?.items).toHaveLength(1);

    expect(api.mergeEntities(
      [{ tenant_id: 'tenant-a', entity_type: 'procurement_plan', business_id: 'PLAN-A', version_id: 'PLAN-A-V1' }],
      [{ tenant_id: 'tenant-a', entity_type: 'procurement_plan', business_id: 'PLAN-A', version_id: 'PLAN-A-V2' }],
    )).toHaveLength(2);
    expect(api.mergeEntities(
      [{ tenant_id: 'tenant-a', entity_type: 'purchase_order', business_id: 'PO-A' }],
      [{ tenant_id: 'tenant-b', entity_type: 'purchase_order', business_id: 'PO-A' }],
    )).toHaveLength(2);
    expect(api.mergeEntities(
      [{ entity_type: 'purchase_order', business_id: 'PO-LEGACY' }],
      [{ entity_type: 'purchase_order', business_id: 'PO-LEGACY' }],
    )).toHaveLength(1);
    expect(api.mergeEntities(
      [{ entity_type: 'purchase_order', business_id: 'PO-LEGACY' }],
      [{ tenant_id: 'tenant-a', entity_type: 'purchase_order', business_id: 'PO-LEGACY' }],
    )).toHaveLength(2);
  });

  it('uses a snapshot task tenant only when a legacy entity has no tenant scope', async () => {
    const api = await renderDirectTask({ withM5: false });
    const base = { diagnostics: { status: 'pass' }, module_runs: [], events: [] };
    const merged = api.mergeSnapshots(
      {
        ...base,
        task: { task_id: 'task-legacy', tenant_id: 'tenant-a' },
        entities: [{ entity_type: 'procurement_plan', business_id: 'PLAN-A', version_id: 'PLAN-A-V1', metadata: {} }],
      },
      {
        ...base,
        task: { task_id: 'task-legacy', tenant_id: 'tenant-a' },
        entities: [{ tenant_id: 'tenant-a', entity_type: 'procurement_plan', business_id: 'PLAN-A', version_id: 'PLAN-A-V1', metadata: { lines: [1] } }],
      },
      'task-legacy',
    );
    expect(merged.entities).toHaveLength(1);
    expect(merged.entities[0]).toMatchObject({ tenant_id: 'tenant-a', business_id: 'PLAN-A' });

    const differentTaskTenants = api.mergeSnapshots(
      {
        ...base,
        task: { task_id: 'task-legacy', tenant_id: 'tenant-a' },
        entities: [{ entity_type: 'purchase_order', business_id: 'PO-SHARED', metadata: {} }],
      },
      {
        ...base,
        task: { task_id: 'task-legacy', tenant_id: 'tenant-b' },
        entities: [{ entity_type: 'purchase_order', business_id: 'PO-SHARED', metadata: {} }],
      },
      'task-legacy',
    );
    expect(differentTaskTenants.entities).toHaveLength(2);
    expect(differentTaskTenants.entities.map((entity) => entity.tenant_id).sort()).toEqual(['tenant-a', 'tenant-b']);

    const conflictingMetadataTenant = api.mergeSnapshots(
      {
        ...base,
        task: { task_id: 'task-legacy', tenant_id: 'tenant-a' },
        entities: [{ entity_type: 'purchase_order', business_id: 'PO-A', metadata: { tenant_id: 'tenant-b' } }],
      },
      {
        ...base,
        task: { task_id: 'task-legacy', tenant_id: 'tenant-a' },
        entities: [{ tenant_id: 'tenant-a', entity_type: 'purchase_order', business_id: 'PO-A', metadata: {} }],
      },
      'task-legacy',
    );
    expect(conflictingMetadataTenant.entities).toHaveLength(2);
  });

  it('shows governed data_incomplete as a warning and blocks the active module', async () => {
    await renderDirectTask({
      withM5: false,
      sparseTracking: true,
      governedDataIncomplete: true,
    });

    const m5 = document.querySelector<HTMLElement>('.step[data-module="m5"]');
    expect(document.querySelector('.hero .status')?.textContent).toBe('需要核对');
    expect(m5?.textContent).toContain('数据未完善');
    expect(m5?.querySelector('.chip')?.textContent).toBe('已阻塞');
  });

  it('renders only a bounded raw summary for a multi-megabyte governed trace', async () => {
    await renderDirectTask({ withM5: false, largeGovernedTrace: true });

    const raw = document.querySelector<HTMLElement>('.raw.overview-only pre')?.textContent ?? '';
    expect(raw).toContain('movement-0');
    expect(raw).not.toContain('movement-100');
    expect(raw).toContain('"__truncated_items__": 9950');
    expect(raw.length).toBeLessThan(100_000);
    expect(document.querySelector('.raw.overview-only summary')?.textContent).toContain('有界摘要');
  });

  it('stops the dependent business chain when M1 fails', async () => {
    const html = await readFile('public/business.html', 'utf8');
    const body = html.match(/<body>([\s\S]*?)<script>/)?.[1];
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    if (!body || !script) throw new Error('Expected Business page body and script');
    document.body.innerHTML = body;

    const catalog = [{
      catalog_id: 'catalog-failed',
      status: '待运行',
      order_id: 'SO-FAILED',
      product_name: '故障订单',
      source_file: 'order.csv',
      source_sheet: 'Sheet1',
      bom_lines: 1,
      data_status: '可执行',
    }];
    const runConfig = [{
      catalog_id: 'catalog-failed',
      product_code: 'FG-FAILED',
      order_url: '/uploads/order-failed.csv',
      order_filename: 'order-failed.csv',
      history_bom_path: '/demo-data/old.xlsx',
      m3_input_url: '/run-config/input-failed.json',
      order: { order_id: 'SO-FAILED', order_qty: 1, due_date: '2026-08-01' },
    }];
    const rootFlows: Array<{ body: Record<string, unknown>; taskId: string }> = [];

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === '/historical-order-catalog.json') return Response.json(catalog);
      if (url === '/run-config/candidate-run-manifest.json') return Response.json(runConfig);
      if (url === '/uploads/order-failed.csv') {
        return {
          ok: true,
          blob: async () => ({
            type: 'text/csv',
            arrayBuffer: async () => new TextEncoder().encode('order_id,quantity\nSO-FAILED,1').buffer,
          }),
        } as Response;
      }
      if (url === '/run-config/input-failed.json') {
        return Response.json({
          order: { order_id: 'SO-FAILED', order_qty: 1 },
          bom: { lines: [] },
          inventory_snapshot: [],
          open_purchase_orders: [],
        });
      }
      if (url === '/api/auth/me') {
        return Response.json({ session: { csrf_token: 'csrf-failed' } });
      }
      if (url === '/api/orchestrator/business-flows') {
        const taskId = new Headers(init?.headers).get('X-Yunpai-Task-ID') ?? '';
        rootFlows.push({
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
          taskId,
        });
        return Response.json({
          run_id: 'FLOW-FAILED',
          tracking_task_id: taskId,
          order_id: 'SO-FAILED',
          mode: 'real',
          status: 'queued',
          current_node: 'intake',
        });
      }
      if (url === '/api/orchestrator/business-flows/FLOW-FAILED') {
        return Response.json({
          run_id: 'FLOW-FAILED',
          tracking_task_id: rootFlows[0]?.taskId,
          requested_order_id: 'SO-FAILED',
          order_id: 'SO-FAILED',
          mode: 'real',
          status: 'failed',
          current_node: 'resolve_order_from_m1',
          error: { code: 'ReadTimeout', message: 'ingest_document: 工具调用失败: ReadTimeout' },
          steps: [{
            tool: 'ingest_document',
            module: 'm1',
            status: 'failed',
            error: '工具 ingest_document 调用失败: ReadTimeout',
          }],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    window.history.pushState(
      {},
      '',
      '/business.html?catalog_id=catalog-failed&action=run',
    );
    new Function(script)();

    await vi.waitFor(() => expect(document.body.textContent).toContain('执行未完成'));
    expect(rootFlows).toHaveLength(1);
    expect(rootFlows[0]?.taskId).toMatch(/^task_[0-9a-f]{32}$/);
    expect(rootFlows[0]?.body).toMatchObject({ order_id: 'SO-FAILED', mode: 'real' });
    expect(document.body.textContent).toContain('ReadTimeout');
  });

  it('creates an allowed anonymous session before querying a direct TaskID link', async () => {
    const html = await readFile('public/business.html', 'utf8');
    const body = html.match(/<body>([\s\S]*?)<script>/)?.[1];
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    if (!body || !script) throw new Error('Expected Business page body and script');
    document.body.innerHTML = body;
    const requests: string[] = [];
    const directSnapshot = {
      task: { task_id: 'task-direct-1', task_summary: '直接查询' },
      generated_at: '2026-07-27T00:00:00Z',
      diagnostics: { status: 'ok' },
      module_runs: [],
      entities: [],
      events: [],
    };
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      if (url === '/historical-order-catalog.json') return Response.json([]);
      if (url === '/run-config/candidate-run-manifest.json') return Response.json([]);
      if (url === '/api/auth/me') return new Response('Unauthorized', { status: 401 });
      if (url === '/api/auth/config') {
        return Response.json({ auth_mode: 'shared_anonymous', capabilities: { anonymous_session: true } });
      }
      if (url === '/api/auth/session/anonymous') {
        return Response.json({ session: { csrf_token: 'csrf-direct' } });
      }
      if (url.startsWith('/api/orchestrator/tracking/tasks/task-direct-1/snapshot')) {
        return Response.json(directSnapshot);
      }
      if (url.startsWith('/api/m5/ops/flow-dashboard?tracking_task_id=task-direct-1')) {
        return Response.json({ success: true, data: [], errors: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    window.history.pushState({}, '', '/business.html?task_id=task-direct-1');
    new Function(script)();
    await vi.waitFor(() => expect(document.querySelectorAll('.pipeline .step')).toHaveLength(5));
    expect(requests.slice(2, 5)).toEqual([
      '/api/auth/me',
      '/api/auth/config',
      '/api/auth/session/anonymous',
    ]);
    expect(document.body.textContent).toContain('M5 尚未接入或尚未生成排程');
  });

  it('keeps M1-M4 visible when M5 has no matching persisted data', async () => {
    await renderDirectTask({ withM5: false });
    expect(document.body.textContent).toContain('SO-EXISTING');
    expect(document.body.textContent).toContain('M4 · 采购建议入库');
    expect(document.body.textContent).toContain('HTTP 可达不代表业务已打通');
  });

  it('shows M3 readiness, persisted M5 kitting, and bounded execution evidence', async () => {
    await renderDirectTask({ withM5: true });

    expect(document.body.textContent).toContain('物料就绪快照');
    expect(document.body.textContent).toContain('M3 物料行齐套率');
    expect(document.body.textContent).toContain('M3 可用库存（传入 M5）');
    expect(document.body.textContent).toContain('M3 在途采购和 M4 采购建议均不是已确认的 M5 到货');
    expect(document.body.textContent).toContain('M5 按订单齐套结果');
    expect(document.body.textContent).toContain('MAT-EXISTING');
    expect(document.body.textContent).toContain('排程流程进度');
    expect(document.body.textContent).toContain('现场工序完成');
    expect(document.body.textContent).toContain('1 / 1 · 100%');
    expect(document.body.textContent).toContain('MES（mes）');
    expect(document.body.textContent).toContain('执行事件（原始）');
  });

  it('does not let persisted M5 schedule evidence hide a failed module status', async () => {
    await renderDirectTask({ withM5: true, m5ModuleStatus: 'fail' });

    const m5Step = document.querySelector<HTMLElement>('.step[data-module="m5"]');
    expect(m5Step?.textContent).toContain('M5 执行失败：M5 scheduling failed');
    expect(m5Step?.textContent).toContain('执行失败');
    expect(m5Step?.textContent).not.toContain('排程流程 20%');
  });

  it('does not let persisted M5 schedule evidence hide a blocked module status', async () => {
    await renderDirectTask({ withM5: true, m5ModuleStatus: 'blocked' });

    const m5Step = document.querySelector<HTMLElement>('.step[data-module="m5"]');
    expect(m5Step?.textContent).toContain('M5 已阻塞：M5 authority facts require review');
    expect(m5Step?.textContent).toContain('已阻塞');
    expect(m5Step?.textContent).not.toContain('排程流程 20%');
  });

  it.each([
    { overallStatus: 'attention' as const, chip: '需关注', body: '排程需关注 · 流程 20%' },
    { overallStatus: 'active' as const, chip: '执行中', body: '排程执行中 20%' },
    { overallStatus: 'complete' as const, chip: '点击查看详情', body: '排程流程 100%' },
  ])('maps persisted M5 $overallStatus status without claiming every plan is complete', async ({ overallStatus, chip, body }) => {
    await renderDirectTask({ withM5: true, m5OverallStatus: overallStatus });

    const m5Step = document.querySelector<HTMLElement>('.step[data-module="m5"]');
    expect(m5Step?.textContent).toContain(body);
    expect(m5Step?.querySelector('.chip')?.textContent).toBe(chip);
  });

  it('keeps absent site feedback distinct from a zero-percent completion claim', async () => {
    await renderDirectTask({
      withM5: true,
      executionSummary: {
        plan_version: 'baseline-existing-1',
        event_count: 0,
        latest_event_at: null,
        late_operation_count: 0,
        exception_count: 0,
        scrap_quantity: 0,
        planned_operation_count: 1,
        started_operation_count: 0,
        completed_operation_count: 0,
        paused_operation_count: 0,
        exception_operation_count: 0,
        completion_rate_percent: null,
        source_event_counts: {},
      },
    });

    expect(document.body.textContent).toContain('0 / 1 · 暂无现场反馈');
    expect(document.body.textContent).not.toContain('0 / 1 · 0%');
    expect(document.body.textContent).toContain('暂无现场反馈事件');
  });

  it('marks simulation feedback as integration evidence rather than live shop-floor proof', async () => {
    await renderDirectTask({
      withM5: true,
      executionSummary: {
        plan_version: 'baseline-existing-1',
        event_count: 2,
        latest_event_at: '2026-07-28T09:00:00Z',
        late_operation_count: 0,
        exception_count: 0,
        scrap_quantity: 0,
        planned_operation_count: 1,
        started_operation_count: 1,
        completed_operation_count: 1,
        paused_operation_count: 0,
        exception_operation_count: 0,
        completion_rate_percent: 100,
        source_event_counts: { simulation: 2 },
      },
    });

    expect(document.body.textContent).toContain('模拟数据来源');
    expect(document.body.textContent).toContain('模拟回传（simulation）');
  });

  it('degrades only the Gantt when persisted M5 schedule detail is unavailable', async () => {
    await renderDirectTask({ withM5: true, scheduleFails: true });
    expect(document.body.textContent).toContain('baseline-existing-1');
    expect(document.body.textContent).toContain('设备排程可视化读取失败');
    expect(document.body.textContent).toContain('M4 · 采购建议入库');
  });
});
