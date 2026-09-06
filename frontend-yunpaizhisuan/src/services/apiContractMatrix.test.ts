import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { readFile } from 'node:fs/promises';
import { server } from '../mocks/server';
import { apiContractIgnoredExports, apiContractManifest, apiContractServiceFiles, type ApiContractItem } from './apiContractManifest';
import * as activityApi from './activityApi';
import * as auditApi from './auditApi';
import * as auditLogger from './auditLogger';
import * as apiGateway from './apiGateway';
import * as apiResponse from './apiResponse';
import * as bomApi from './bomApi';
import * as businessTraceApi from './businessTraceApi';
import * as businessFlowRunApi from './businessFlowRunApi';
import * as chatApi from './chatApi';
import * as dashboardApi from './dashboardApi';
import * as evidenceApi from './evidenceApi';
import * as flowApi from './flowApi';
import * as httpClient from './httpClient';
import * as legalApi from './legalApi';
import * as leaderApi from './leaderApi';
import * as m0Api from './m0Api';
import * as m0DocumentsApi from './m0DocumentsApi';
import * as m0WikiApi from './m0WikiApi';
import * as m1Api from './m1Api';
import * as m2Api from './m2Api';
import * as m3Api from './m3Api';
import * as m4Api from './m4Api';
import * as m5Api from './m5Api';
import * as m6Api from './m6Api';
import * as m7Api from './m7Api';
import * as m8Api from './m8Api';
import * as moduleApi from './moduleApi';
import * as pieceWageApi from './pieceWageApi';
import * as notificationApi from '../features/notifications/notificationApi';
import * as orchestratorApi from './orchestratorApi';
import * as orderMultipartApi from './orderMultipartApi';
import * as permissionApi from './permissionApi';
import * as purchaseApi from './purchaseApi';
import * as qcApi from './qcApi';
import * as scheduleApi from './scheduleApi';
import * as sopApi from './sopApi';
import * as taskApi from './taskApi';
import * as trackingSnapshotApi from './trackingSnapshotApi';
import * as uploadWithProgress from './uploadWithProgress';

type ServiceModule = Record<string, unknown>;

type ContractCase = {
  call: () => Promise<unknown>;
  expectedUrl: string | string[];
  assertRequest?: (init: RequestInit) => void;
};

const serviceModules: Record<string, ServiceModule> = {
  'src/services/activityApi.ts': activityApi,
  'src/services/auditApi.ts': auditApi,
  'src/services/auditLogger.ts': auditLogger,
  'src/services/apiGateway.ts': apiGateway,
  'src/services/apiResponse.ts': apiResponse,
  'src/services/bomApi.ts': bomApi,
  'src/services/businessFlowRunApi.ts': businessFlowRunApi,
  'src/services/businessTraceApi.ts': businessTraceApi,
  'src/services/chatApi.ts': chatApi,
  'src/services/dashboardApi.ts': dashboardApi,
  'src/services/evidenceApi.ts': evidenceApi,
  'src/services/flowApi.ts': flowApi,
  'src/services/httpClient.ts': httpClient,
  'src/services/legalApi.ts': legalApi,
  'src/services/leaderApi.ts': leaderApi,
  'src/services/m0Api.ts': m0Api,
  'src/services/m0DocumentsApi.ts': m0DocumentsApi,
  'src/services/m0WikiApi.ts': m0WikiApi,
  'src/services/m1Api.ts': m1Api,
  'src/services/m2Api.ts': m2Api,
  'src/services/m3Api.ts': m3Api,
  'src/services/m4Api.ts': m4Api,
  'src/services/m5Api.ts': m5Api,
  'src/services/m6Api.ts': m6Api,
  'src/services/m7Api.ts': m7Api,
  'src/services/m8Api.ts': m8Api,
  'src/services/moduleApi.ts': moduleApi,
  'src/services/pieceWageApi.ts': pieceWageApi,
  'src/features/notifications/notificationApi.ts': notificationApi,
  'src/services/orchestratorApi.ts': orchestratorApi,
  'src/services/orderMultipartApi.ts': orderMultipartApi,
  'src/services/permissionApi.ts': permissionApi,
  'src/services/purchaseApi.ts': purchaseApi,
  'src/services/qcApi.ts': qcApi,
  'src/services/scheduleApi.ts': scheduleApi,
  'src/services/sopApi.ts': sopApi,
  'src/services/taskApi.ts': taskApi,
  'src/services/trackingSnapshotApi.ts': trackingSnapshotApi,
  'src/services/uploadWithProgress.ts': uploadWithProgress,
};

const dashboardSummary = {
  modules: [{ id: 'm1', name: 'M1', status: 'normal', metric: 1, riskLevel: 'none' }],
  activities: [{ id: 'act-1', time: '2026-07-10T00:00:00Z', module: 'M1', message: 'done', status: 'success' }],
  risks: [{ id: 'risk-1', title: 'risk', module: 'M4', level: 'low', description: 'low risk' }],
};

const auditLog = {
  id: 'LOG-1',
  time: '2026-07-10T00:00:00Z',
  actor: 'tester',
  action: 'contract',
  module: 'M4',
  targetId: 'T-1',
  result: 'success' as const,
  detail: 'contract checked',
};

const m1Task = {
  id: 'M1-TASK-001',
  filename: 'drawing.pdf',
  status: 'completed',
  progress: 100,
  fileStatus: [{ filename: 'drawing.pdf', status: 'completed' }],
};

const m1ReviewItem = {
  id: 'M1-REV-001',
  taskId: 'M1-TASK-001',
  field: '交付日期',
  recognizedValue: '2026-07-10',
  confidence: 0.8,
  status: 'confirmed' as const,
};

const agentTask = {
  id: 'flow:FLOW-CONTRACT-001:resolve_or_generate_bom:1',
  title: '确认 BOM 生成问题',
  owner: 'M2 Agent',
  status: 'need_review',
  riskLevel: 'medium',
  agent: 'm2',
  kind: 'business_flow_attention',
  business_status: 'human_input_required',
  reminder_status: 'unread',
  detail: '流程正在等待人工处理',
  tracking_task_id: 'task_contract_001',
  run_id: 'FLOW-CONTRACT-001',
  order_id: 'ORD-CONTRACT-001',
  current_node: 'resolve_or_generate_bom',
  step_status: 'human_input_required',
  is_history: false,
  created_at: '2026-08-20T00:00:00Z',
  updated_at: '2026-08-20T00:00:00Z',
  target: {
    type: 'business_flow',
    run_id: 'FLOW-CONTRACT-001',
    tracking_task_id: 'task_contract_001',
    order_id: 'ORD-CONTRACT-001',
    section: 'human_gate',
  },
};

const m4Supplier = {
  id: 1,
  supplier_name: '华东供应商',
  contact_name: '张三',
  email: 'buyer@example.test',
  default_channel: 'email',
  status: 'active',
  remark: 'ok',
};

const m4Suggestion = {
  id: 101,
  batch_id: 1,
  row_number: 1,
  item_code: 'MAT-001',
  item_name: '铝板',
  quantity: '2',
  unit: '件',
  supplier_name: '华东供应商',
  required_date: '2026-07-30',
  project_code: 'P-001',
  validation_status: 'valid',
  error_message: '',
};

const m4Batch = {
  id: 1,
  filename: 'purchase.csv',
  total_rows: 1,
  valid_rows: 1,
  invalid_rows: 0,
  duplicate_rows: 0,
  status: 'completed',
  created_at: '2026-07-10T00:00:00Z',
  items: [m4Suggestion],
};

const m4PurchaseOrder = {
  id: 201,
  purchase_order_no: 'PO-001',
  supplier_name: '华东供应商',
  status: 'pending_review',
  required_date: '2026-08-01',
  items: [{ id: 301, item_code: 'MAT-001', item_name: '铝板', quantity: '2', unit: '件', status: 'pending' }],
};

const m4Inquiry = {
  message_id: 401,
  subject: '询价',
  content: '请确认交期',
  channel: 'email',
  recipient: 'buyer@example.test',
  send_status: 'draft',
};

const m4Reply = {
  id: 501,
  purchase_order_id: 201,
  purchase_order_no: 'PO-001',
  supplier_name: '华东供应商',
  reply_content: '7月25日可交付',
  received_at: '2026-07-10T00:00:00Z',
};

const m4ParseResult = {
  delivery_date: '2026-07-25',
  unit_price: '12.50',
  currency: 'CNY',
  tax_included: true,
  exception_type: null,
  exception_description: null,
  confidence: 0.9,
  need_human_review: false,
};

const m4Tracking = {
  id: 601,
  purchase_order_item_id: 301,
  promised_date: '2026-07-25',
  unit_price: '12.50',
  currency: 'CNY',
  exception_type: null,
  exception_description: null,
  arrival_status: 'not_received',
  is_overdue: false,
};

const m4Alert = {
  id: 701,
  alert_type: 'overdue',
  purchase_order_no: 'PO-001',
  supplier_name: '华东供应商',
  item_code: 'MAT-001',
  item_name: '铝板',
  promised_date: '2026-07-25',
  days_overdue: 2,
  urge_message: '请尽快反馈',
  status: 'open',
};

const m5Schedule = {
  plan_version: 'PV-001',
  resources: [{ id: 'line-1', name: '产线 1' }],
  operations: [
    {
      order_id: 'ORD-001',
      operation_id: 'OP-001',
      operation_name: '切割',
      resource_id: 'line-1',
      resource_name: '产线 1',
      start_day: 2,
      duration_days: 3,
      status: 'solved',
    },
  ],
};

const m8Project = { project_id: 'M8-PROJ-001', status: 'active' };
const m8Run = { run_id: 'M8-RUN-001', status: 'done' };

const demoBomItem = {
  id: 'BOM-001',
  code: 'MAT-001',
  name: '铝板',
  quantity: 2,
  unit: '件',
  confidence: 0.95,
  status: 'normal',
};

const demoSopStep = {
  id: 'SOP-001',
  title: '切割',
  equipment: '切割机',
  durationMinutes: 30,
  note: '按工艺执行',
};

const demoPurchaseWarning = {
  id: 'PW-001',
  supplier: '华东供应商',
  item: '铝板',
  overdueDays: 2,
  severity: 'medium',
  status: 'open',
};

const demoLegalRisk = {
  id: 'LEGAL-001',
  title: '合同风险',
  riskLevel: 'medium',
  reviewRound: 'final',
  summary: '需终审',
  status: 'pending',
};

const demoNotification = {
  id: 'NOTIF-CONTRACT-001',
  type: 'contract',
  title: '契约测试通知',
  detail: 'contract notification',
  severity: 'info',
  link: '/dashboard',
  source: 'system',
  createdAt: '2026-08-10T00:00:00.000Z',
};

const m0MasterDocument = {
  id: 1,
  batch_id: 'M0-BATCH-001',
  domain: 'drawing',
  doc_type: 'engineering_drawing',
  doc_no: '',
  title: '图纸_承认书_ABC-123.pdf',
  content_text: '',
  stored_name: 'mock-drawing.pdf',
  status: 'approved',
  created_at: '2026-08-10T00:00:00Z',
};

const m0DocumentBinding = {
  id: 11,
  doc_id: 1,
  entity_type: 'material',
  entity_id: 'CABLE-2M',
  entity_code: 'CABLE-2M',
  entity_name: 'HDMI 线材 2M',
  stage: '押出',
  created_by: 'mock',
  created_at: '2026-08-10T00:00:00Z',
};

const page = <T>(item: T) => ({ items: [item], page: 1, page_size: 20, total: 1 });
const envelope = <T>(data: T) => ({ success: true, data, errors: [] });

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });

const textResponse = (payload: string, contentType = 'text/plain') =>
  new Response(payload, { status: 200, headers: { 'Content-Type': contentType } });

const blobResponse = (payload = 'binary') =>
  new Response(payload, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });

const responseFor = (item: ApiContractItem, callIndex = 0) => {
  if (item.id.startsWith('evidence.')) {
    if (item.id.endsWith('.review')) return jsonResponse(envelope([{ batch_id: 'EV-BATCH-1', state: 'awaiting_review', rows: [] }]));
    if (item.id.endsWith('.detail')) return jsonResponse(envelope({ batch_id: 'EV-BATCH-1', state: 'awaiting_review', rows: [] }));
    if (item.id.endsWith('.history')) return jsonResponse(envelope([{ id: 'audit-1', batch_id: 'EV-BATCH-1', from_state: 'received', to_state: 'awaiting_review' }]));
    if (item.id.endsWith('.resolve')) return jsonResponse(envelope({ row_id: 'EV-ROW-1', row_state: 'ok', corrections: [], source_refs: [], allowed_actions: [] }));
    return jsonResponse(envelope({ batch_id: 'EV-BATCH-1', state: 'committed', applied_ref: 'APPLIED-1' }));
  }
  switch (item.id) {
    case 'business-trace.order-trace':
      return jsonResponse({
        tenant_id: 'default',
        order_id: 'SO-1',
        order: { order_id: 'SO-1', product_id: 'FG-1' },
        materials: [],
        order_materials: [],
        inventory_balances: [],
        inventory_movements: [],
        procurement_plans: [],
        procurement_plan_lines: [],
        purchase_orders: [],
        schedule_versions: [],
        business_flow_runs: [],
        fact_versions: [],
        calculation_runs: [],
        validation_results: [],
        supply_allocations: [],
        recalculation_jobs: [],
      });
    case 'business-trace.flow-trace':
      return jsonResponse({
        tenant_id: 'default',
        order_id: '验收HBOM-1.csv',
        order: { order_id: '验收HBOM-1.csv', product_id: 'FG-1' },
        materials: [],
        order_materials: [],
        inventory_balances: [],
        inventory_movements: [],
        procurement_plans: [],
        procurement_plan_lines: [],
        purchase_orders: [],
        schedule_versions: [],
        business_flow_runs: [],
        fact_versions: [],
        calculation_runs: [],
        validation_results: [],
        supply_allocations: [],
        recalculation_jobs: [],
      });
    case 'business-trace.material-trace':
      return jsonResponse({
        tenant_id: 'default',
        material_id: 'MAT-1',
        material: { material_id: 'MAT-1' },
        balances: [],
        movements: [],
        facts: { consumption: [], production_output: [], inspection: [] },
        lots: [],
        lot_chain: [],
        yield_summary: [],
      });
    case 'business-trace.cost-variance':
      return jsonResponse({
        period: '2026-08',
        currency: 'CNY',
        method: 'actual_vs_standard_v1',
        lines: [],
        totals: { standard_cost: '0', actual_cost: '0', variance: '0' },
        data_quality: { mock_prices: true, missing_materials: [] },
      });
    case 'business-trace.finished-goods':
      return jsonResponse({
        tenant_id: 'default',
        items: [
          {
            material_id: 'FG-1',
            order_id: 'SO-1',
            material_code: 'FG-1',
            name: '成品',
            unit: 'PCS',
            balance: {
              location_id: 'FG-WH',
              quantity_on_hand: '3',
              quantity_available: '3',
              quantity_blocked: '0',
            },
            produced_total: '3',
            defect_total: '1',
            good_total: '2',
            yield_rate: 0.6667,
            lots: ['BATCH-1'],
            yield_summary: [],
          },
        ],
      });
    case 'business-trace.consumption-variance':
      return jsonResponse({
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
        ],
        totals: {
          count: 1,
          standard_qty: '21',
          actual_qty: '23',
          variance: '2',
          reasons: { 损耗: 1 },
        },
        pagination: { limit: 200, offset: 0, total: 1 },
      });
    case 'business-trace.consumption-variance-refresh':
      return jsonResponse({
        refreshed: 1,
        orders: ['SO-1'],
        snapshot_ts: '2026-08-10T00:00:00Z',
      });
    case 'business-trace.order-outbound-flow':
      return jsonResponse({
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
                occurred_at: '2026-08-05T00:00:00Z',
              },
            ],
          },
        ],
      });
    case 'business-trace.flow-outbound-flow':
      return jsonResponse({
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
            movements: [],
          },
        ],
      });
    case 'business-trace.inspect-finished-goods':
      return jsonResponse({ fact: { fact_version_id: 'fact-inspect-1' } });
    case 'business-trace.publish-fact':
      return jsonResponse(
        {
          fact: { fact_type: 'receipt', payload_digest: 'contract' },
          recalculation: null,
        },
        202,
      );
    case 'business-trace.execution-output':
      return jsonResponse(
        {
          fact: { fact_type: 'production_output', payload_digest: 'contract' },
          recalculation: { status: 'completed', affected_order_count: 1 },
        },
        202,
      );
    case 'evidence.review-queue':
      return jsonResponse(envelope([{ batch_id: 'EV-BATCH-1', state: 'awaiting_review', rows: [] }]));
    case 'evidence.batch-detail':
      return jsonResponse(envelope({ batch_id: 'EV-BATCH-1', state: 'awaiting_review', rows: [] }));
    case 'evidence.audit-history':
      return jsonResponse(envelope([{ id: 'audit-1', batch_id: 'EV-BATCH-1', from_state: 'received', to_state: 'awaiting_review' }]));
    case 'evidence.row-resolve':
      return jsonResponse(envelope({ row_id: 'EV-ROW-1', row_state: 'ok', corrections: [], source_refs: [] }));
    case 'evidence.batch-commit':
      return jsonResponse(envelope({ batch_id: 'EV-BATCH-1', state: 'committed' }));
    case 'gateway.dashboard.summary':
      return jsonResponse({ status: 'ok' });
    case 'gateway.dashboard.module-statuses':
      return jsonResponse(dashboardSummary.modules);
    case 'gateway.tasks.list':
      return jsonResponse([
        { id: 'TASK-1', title: '任务', owner: 'tester', status: 'pending', riskLevel: 'low', updatedAt: '2026-07-10T00:00:00Z' },
      ]);
    case 'gateway.tasks.update':
      return jsonResponse({
        id: 'TASK-1',
        title: '任务',
        owner: 'tester',
        status: 'completed',
        riskLevel: 'low',
        updatedAt: '2026-07-10T00:00:00Z',
      });
    case 'orchestrator.agent-tasks.list':
      return jsonResponse([agentTask]);
    case 'orchestrator.agent-tasks.history':
      return jsonResponse([{ ...agentTask, is_history: true, reminder_status: 'read' }]);
    case 'orchestrator.agent-tasks.reminder':
      return jsonResponse({ ...agentTask, reminder_status: 'dismissed' });
    case 'gateway.audit.logs.list':
      return jsonResponse([auditLog]);
    case 'gateway.audit.logs.write':
      return jsonResponse(auditLog, 201);
    case 'gateway.workbench.activities':
      if (callIndex === 0) {
        return jsonResponse([auditLog]);
      }
      if (callIndex === 6) {
        return jsonResponse(envelope([]));
      }
      return jsonResponse({ status: 'ok' });
    case 'gateway.auth.me':
      return jsonResponse({ role: { id: 'operator', name: '业务操作员', permissions: ['dashboard:read', 'm4:read', 'm4:operate'] } });
    case 'gateway.flow.agent':
      return jsonResponse({ status: 'ok' });
    case 'gateway.flow.agent-from-job':
    case 'orchestrator.job.get':
      return jsonResponse({
        job_id: 'orch-job-001',
        status: 'done',
        tools: ['m1'],
        session_id: 'session-1',
        steps: [{ id: 'step-1', name: 'M1', module: 'M1', status: 'done' }],
        result: { content: 'done' },
      });
    case 'orchestrator.health':
      return jsonResponse({ status: 'ok' });
    case 'orchestrator.business-flows.create':
      return jsonResponse({
        run_id: 'FLOW-CONTRACT-001',
        tracking_task_id: 'task_contract_001',
        order_id: 'ORD-CONTRACT-001',
        mode: 'real',
        status: 'queued',
        current_node: 'intake',
      }, 202);
    case 'orchestrator.business-flows.resume':
      return jsonResponse({
        resumed: true,
        run_id: 'FLOW-CONTRACT-001',
        tracking_task_id: 'task_contract_001',
        order_id: 'ORD-CONTRACT-001',
        status: 'queued',
        current_node: 'intake',
      }, 202);
    case 'orchestrator.business-flows.get':
      return jsonResponse({
        run_id: 'FLOW-CONTRACT-001',
        tracking_task_id: 'task_contract_001',
        requested_order_id: 'ORD-CONTRACT-001',
        order_id: 'ORD-CONTRACT-001',
        mode: 'real',
        status: 'completed',
        current_node: 'persist_trace',
        steps: [],
      });
    case 'orchestrator.business-orders.trace':
      return jsonResponse({
        tenant_id: 'default',
        order_id: 'ORD-CONTRACT-001',
        order: { order_id: 'ORD-CONTRACT-001' },
        materials: [],
        order_materials: [],
        inventory_balances: [],
        inventory_movements: [],
        procurement_plans: [],
        procurement_plan_lines: [],
        purchase_orders: [],
        schedule_versions: [],
        business_flow_runs: [{ run_id: 'FLOW-CONTRACT-001' }],
      });
    case 'orchestrator.business-flows.trace':
      return jsonResponse({
        tenant_id: 'default',
        order_id: '验收HBOM-1.csv',
        order: { order_id: '验收HBOM-1.csv', product_id: 'FG-1' },
        materials: [],
        order_materials: [],
        inventory_balances: [],
        inventory_movements: [],
        procurement_plans: [],
        procurement_plan_lines: [],
        purchase_orders: [],
        schedule_versions: [],
        business_flow_runs: [{ run_id: 'FLOW-1' }],
      });
    case 'orchestrator.business-tasks.trace':
      return jsonResponse({
        flow: {
          run_id: 'FLOW-CONTRACT-001',
          tracking_task_id: 'task_contract_001',
          requested_order_id: 'ORD-CONTRACT-001',
          order_id: 'ORD-CONTRACT-001',
          mode: 'real',
          status: 'completed',
          current_node: 'persist_trace',
          steps: [],
        },
        trace: {
          tenant_id: 'default', order_id: 'ORD-CONTRACT-001', order: { order_id: 'ORD-CONTRACT-001' },
          materials: [], order_materials: [], inventory_balances: [], inventory_movements: [],
          procurement_plans: [], procurement_plan_lines: [], purchase_orders: [], schedule_versions: [], business_flow_runs: [],
        },
      });
    case 'orchestrator.invoke':
      return jsonResponse({ job_id: 'orch-job-001', status: 'running', tools: ['m1'], session_id: 'session-1' });
    case 'orchestrator.jobs.list':
      return jsonResponse({
        items: [{ job_id: 'orch-job-001', status: 'done', tools: ['m1'], steps: [] }],
        total: 1,
      });
    case 'orchestrator.memory.similar':
      return jsonResponse({ items: [] });
    case 'orchestrator.tracking.snapshot':
      return jsonResponse({
        task_id: 'task_contract_001',
        status: 'success',
        module_runs: [{ module: 'm1', status: 'done' }],
        entities: [{ entity_id: 'bom-1', entity_type: 'bom', module: 'm2' }],
        events: [],
      });
    case 'orchestrator.chat.stream':
      return textResponse(
        [
          '{"type":"message_start","message_id":"msg_contract","session_id":"session-1","conversation_id":"assistant","created_at":"2026-07-16T00:00:00Z"}',
          '{"type":"delta","message_id":"msg_contract","content":"ok"}',
          '{"type":"message_done","message_id":"msg_contract","finish_reason":"stop"}',
        ].join('\n') + '\n',
        'application/x-ndjson',
      );
    case 'orchestrator.chat.conversations.list':
    case 'orchestrator.chat.messages.list':
      return jsonResponse({ items: [], next_cursor: null });
    case 'orchestrator.chat.conversations.create':
    case 'orchestrator.chat.conversations.rename':
      return jsonResponse({ id: '11111111-1111-4111-8111-111111111111', title: 'New conversation', title_source: 'manual', status: 'active', created_at: '2026-07-21T00:00:00Z', updated_at: '2026-07-21T00:00:00Z', version: 2 });
    case 'orchestrator.chat.messages.local-assistant':
      return jsonResponse({
        message: { id: '22222222-2222-4222-8222-222222222222', role: 'assistant', content: '识别完成', status: 'completed', created_at: '2026-07-21T00:00:00Z', structured_data: { kind: 'm7_delivery_draft', draft: null }, run: null },
        conversation: { id: '11111111-1111-4111-8111-111111111111', title: 'New conversation', title_source: 'manual', status: 'active', created_at: '2026-07-21T00:00:00Z', updated_at: '2026-07-21T00:00:00Z', version: 2 },
      });
    case 'orchestrator.chat.conversations.delete':
      return new Response(null, { status: 204 });
    case 'orchestrator.chat.follow-ups':
      return jsonResponse({ questions: ['哪些订单存在延期风险？', '帮我排查本周排程冲突'], source: 'llm' });
    case 'm0.import.upload':
      return jsonResponse(envelope({ id: 'B-M0-1', status: 'ready', source_names: 'a.csv', stats: {}, tenant_id: 'default', created_by: 'contract', created_at: '2026-08-10T00:00:00Z', updated_at: '2026-08-10T00:00:00Z' }), 202);
    case 'm0.import.batches.list':
      return jsonResponse(envelope({ batches: [{ id: 'B-M0-1', status: 'received', source_names: 'a.csv', stats: {}, tenant_id: 'default', created_by: 'contract', created_at: '2026-08-10T00:00:00Z', updated_at: '2026-08-10T00:00:00Z' }] }));
    case 'm0.import.batch.detail':
      return jsonResponse(envelope({ batch: { id: 'B-M0-1', status: 'received', source_names: 'a.csv', stats: {}, tenant_id: 'default', created_by: 'contract', created_at: '2026-08-10T00:00:00Z', updated_at: '2026-08-10T00:00:00Z' }, documents: [], stats: {} }));
    case 'm0.import.master':
      return jsonResponse(envelope({ items: [{ material_code: 'CABLE-2M', name: 'HDMI 线材 2M', loss_rate: 0.03 }] }));
    case 'm0.import.master.update':
      return jsonResponse(envelope({ row: { id: 5, machine_code: 'M-001', machine_name: '注塑机（改）' }, affected: 1 }));
    case 'm0.import.master.create':
      return jsonResponse(envelope({ row: { id: 9, machine_code: 'M-099', machine_name: '新设备' }, id: 9 }));
    case 'm0.import.master.delete':
      return jsonResponse(envelope({ deleted: 5 }));
    case 'm0.import.extract.retry':
      return jsonResponse(envelope({ batch_id: 'B-M0-1', retried: 1, document_ids: [1] }));
    case 'm0.import.batch.preview':
      return jsonResponse(envelope({ batch: { id: 'B-M0-1', status: 'received', source_names: 'a.csv', stats: {}, tenant_id: 'default', created_by: 'contract', created_at: '2026-08-10T00:00:00Z', updated_at: '2026-08-10T00:00:00Z' }, documents: [], rows: [], entities: [], mappings: [], quarantine: [], ledger: [] }));
    case 'm0.import.batch.resolve-entity':
      return jsonResponse(envelope({ id: 1, batch_id: 'B-M0-1', code: 'M-1', name: '铝板', uom: '件', spec: '', aliases: [], identity_conflict: '', status: 'approved' }));
    case 'm0.import.batch.resolve-document':
      return jsonResponse(envelope({ id: 3, batch_id: 'B-M0-1', original_name: 'candidate.xlsx', stored_name: 'candidate.xlsx', content_hash: 'hash', detected_format: 'xlsx', declared_ext: 'xlsx', domain: 'unclassified', confidence: 0.8, status: 'ok', message: 'approved', row_count: 0, extract_status: 'agent_needs_review', extract_task_id: '', extract_content: '{}' }));
    case 'm0.import.batch.resolve-mapping':
      return jsonResponse(envelope({ id: 2, batch_id: 'B-M0-1', entity_id: 1, source_ref: 'A', target_ref: 'T-1', status: 'approved', evidence: '', resolved_by: 'contract', resolved_at: '2026-08-10T00:00:00Z' }));
    case 'm0.import.batch.commit':
      return jsonResponse(envelope({ batch_id: 'B-M0-1', status: 'committed', master_counts: {} }));
    case 'm0.import.batch.rollback':
      return jsonResponse(envelope({ batch_id: 'B-M0-1', status: 'rolled_back' }));
    case 'm0.import.quarantine.list':
      return jsonResponse(envelope({ items: [{ id: 1, batch_id: 'B-M0-1', original_name: 'bad.bin', stored_name: 'x', content_hash: 'h', reason: 'unsupported', detail: '', created_at: '2026-08-10T00:00:00Z' }] }));
    case 'm0.master.inventory.list':
      return jsonResponse(envelope({ items: [{ material_code: 'MAT-001', material_name: '铝板', qty: 10, uom: '件' }] }));
    case 'm0.documents.list':
      return jsonResponse(envelope({ documents: [{ ...m0MasterDocument, bindings: [m0DocumentBinding] }] }));
    case 'm0.documents.bindings.create':
      return jsonResponse(envelope({ bindings: [{ ...m0DocumentBinding, id: 12 }] }));
    case 'm0.documents.bindings.list':
      return jsonResponse(envelope({ document: m0MasterDocument, bindings: [m0DocumentBinding] }));
    case 'm0.documents.bindings.delete':
      return jsonResponse(envelope({ deleted: 7 }));
    case 'm0.documents.doc_type.update':
      return jsonResponse(envelope({ document: { ...m0MasterDocument, doc_type: 'test_method' } }));
    case 'm0.documents.file':
      return blobResponse('%PDF-1.4 contract');
    case 'm0.wiki.search':
      return jsonResponse(envelope({
        results: [{ entity_id: 'order-1', entity_type: 'order', business_key: 'SO-001', score: 100 }],
      }));
    case 'm0.wiki.product.get':
      return jsonResponse(envelope({
        product: { entity_id: 'product-1', business_key: 'P/001', label: '产品 1', status: 'active' },
        indexes: {}, families: [], same_family_products: [], routes: [], graph: { nodes: [], edges: [] },
        history: [], summary: {},
      }));
    case 'm0.wiki.bom.lines':
      return jsonResponse(envelope({ bom: 'BOM-001', revision: 'R 02', lines: [] }));
    case 'm0.wiki.bom.diff':
      return jsonResponse(envelope({
        bom: 'BOM-001', base_revision: 'R01', target_revision: 'R02', added: [], removed: [], changed: [],
      }));
    case 'm0.wiki.material.get':
      return jsonResponse(envelope({
        material: { entity_id: 'material-1', business_key: 'MAT/001', status: 'active' },
        summary: {}, history: [],
      }));
    case 'm0.wiki.equipment.get':
      return jsonResponse(envelope({
        entity: { entity_id: 'equipment-1', business_key: 'EQ/001', status: 'active' },
        summary: {}, history: [],
      }));
    case 'm0.wiki.entity.get':
      return jsonResponse(envelope({
        entity: { entity_id: 'order-1', version_row_id: 'row-1', entity_type: 'order', business_key: 'SO/001' },
        history: [], lines: [], summary: { sources: 0, relations: 0 },
      }));
    case 'm0.wiki.entity.create':
      return jsonResponse(envelope({
        action: 'create', entity: { entity_id: 'product-1', entity_type: 'product', business_key: 'P-001' }, publication: {},
      }), 201);
    case 'm0.wiki.entity.update':
      return jsonResponse(envelope({
        action: 'update', entity: { entity_id: 'order-1', entity_type: 'order', business_key: 'SO-001' }, publication: {},
      }));
    case 'm0.wiki.entity.delete':
      return jsonResponse(envelope({
        action: 'delete', entity: { entity_id: 'order-1', entity_type: 'order', business_key: 'SO-001' }, publication: {},
      }));
    case 'm1.ingest.single':
      return jsonResponse({ task_id: 'M1-TASK-001' }, 202);
    case 'm1.ingest.sync':
      return jsonResponse({ task_id: 'M1-TASK-SYNC-001', status: 'completed' });
    case 'm1.ingest.batch':
      return jsonResponse({ task_ids: ['M1-TASK-001'], failed_files: [] }, 202);
    case 'm1.ingest.archive':
      return jsonResponse({ task_id: 'M1-TASK-ZIP-001', extracted_files: 2, failed_files: [] }, 202);
    case 'm1.batch.get':
    case 'm1.tasks.list-filtered':
    case 'm1.tasks.list':
      return jsonResponse([m1Task]);
    case 'm1.tasks.detail':
      return jsonResponse(m1Task);
    case 'm1.files.preview':
    case 'm1.report.download':
    case 'm2.artifact.download':
    case 'm8.assets.blob':
      return blobResponse();
    case 'm1.review.queue':
      return jsonResponse([m1ReviewItem]);
    case 'm1.review.submit':
      return jsonResponse(m1ReviewItem);
    case 'm1.report.generate':
      return jsonResponse({ taskId: 'M1-TASK-001', reportId: 'RPT-1', status: 'generated' });
    case 'm1.tasks.delete':
      return jsonResponse({ taskId: 'M1-TASK-001', deleted: true });
    case 'm2.health':
      return jsonResponse({ status: 'ok' });
    case 'm2.workflow.run':
      return jsonResponse({ result: { workflow_id: 'M2-RUN-001' } });
    case 'm2.artifact.read-json':
      return jsonResponse({ status: 'ok' });
    case 'm2.bom.history.search':
      return jsonResponse({ items: [demoBomItem] });
    case 'm2.bom.controlled.generate':
      return jsonResponse({ bom_id: 'BOM-CONTROLLED-001' });
    case 'm2.bom.template.onboard':
      return jsonResponse({ template_id: 'TPL-001' });
    case 'm2.sop.generate':
      return jsonResponse({ sop_id: 'SOP-001' });
    case 'm3.orders.list':
      return jsonResponse(envelope([{ order_id: 'ORD-001' }]));
    case 'm3.orders.detail':
      return jsonResponse(envelope({ order_id: 'ORD-001' }));
    case 'm3.procurement-requirements.run-json':
    case 'm3.procurement-requirements.run-json-envelope':
    case 'm3.procurement-plan.run-json':
    case 'm3.procurement-plan.run':
    case 'm3.procurement-plan.detail':
      return jsonResponse(envelope({ plan_id: 'PLAN-001' }));
    case 'm3.procurement-plan.list':
      return jsonResponse(envelope({ plan_id: 'PLAN-001' }));
    case 'm3.approval-tasks.list':
      return jsonResponse(envelope([{ task_id: 'APP-001', status: 'pending' }]));
    case 'm3.approval-tasks.approve':
      return jsonResponse(envelope({ task_id: 'APP-001', status: 'approved' }));
    case 'm3.approval-tasks.reject':
      return jsonResponse(envelope({ task_id: 'APP-001', status: 'rejected' }));
    case 'm3.approval-tasks.request-change':
      return jsonResponse(envelope({ task_id: 'APP-001', status: 'change_requested' }));
    case 'm3.approval-tasks.approve-to-send':
      return jsonResponse(envelope({ task_id: 'APP-001', status: 'approved_to_send' }));
    case 'm3.material-readiness':
      return jsonResponse(envelope({
        material_ready_status: 'ready',
        pmc_release_recommendation: 'ready_for_formal_schedule',
        lines: [],
      }));
    case 'm3.persisted-procurement-plans.list':
      return jsonResponse(
        envelope({
          total: 1,
          page: 1,
          page_size: 50,
          items: [
            {
              procurement_plan_id: 'PLAN-001',
              order_id: 'ORD-001',
              project_id: 'PRJ-001',
              plan_version: 'v1',
              status: 'ready_for_m4',
              availability_status: 'partial_shortage',
              line_count: 7,
              shortage_count: 2,
              created_at: '2026-08-09T00:00:00Z',
            },
          ],
        }),
      );
    case 'm3.pr-po-drafts':
      return jsonResponse(envelope({
        status: 'blocked_by_procurement_approval',
        release_gate: 'procurement_plan_approval',
        purchase_requisition_draft: {
          draft_id: 'PR-DRAFT-001',
          status: 'blocked_by_procurement_approval',
          lines: [],
        },
        purchase_order_drafts: [],
      }));
    case 'm3.procurement-plan.handoff-to-m4':
      return jsonResponse(envelope({ plan_id: 'PLAN-001', handed_off: true }));
    case 'm3.procurement-plan.export-suggestions':
      return jsonResponse(envelope({ plan_id: 'PLAN-001', suggestions: [], count: 0 }));
    case 'm4.suppliers.list':
      return jsonResponse(page(m4Supplier));
    case 'm4.suppliers.create':
    case 'm4.suppliers.update':
      return jsonResponse(m4Supplier);
    case 'm4.import-batches.upload':
    case 'm4.import-batches.detail':
      return jsonResponse(m4Batch);
    case 'm4.suggestions.import-json':
      return jsonResponse(m4Batch);
    case 'm4.suggestions.list':
      return jsonResponse(page(m4Suggestion));
    case 'm4.purchase-orders.generate':
      return jsonResponse([m4PurchaseOrder]);
    case 'm4.purchase-orders.list':
      return jsonResponse(page(m4PurchaseOrder));
    case 'm4.purchase-orders.detail':
    case 'm4.purchase-orders.update':
    case 'm4.purchase-orders.submit-review':
    case 'm4.purchase-orders.approve':
    case 'm4.purchase-orders.reject':
    case 'm4.purchase-orders.send':
    case 'm4.purchase-orders.simulate-confirm':
      return jsonResponse(m4PurchaseOrder);
    case 'm4.purchase-orders.inquiry-message':
      return jsonResponse(m4Inquiry);
    case 'm4.replies.create':
      return jsonResponse(m4Reply);
    case 'm4.replies.parse':
    case 'm4.replies.confirm':
      return jsonResponse(m4ParseResult);
    case 'm4.tracking.list':
      return jsonResponse(page(m4Tracking));
    case 'm4.tracking.export-csv':
      return textResponse('purchase_order_item_id,promised_date\n301,2026-07-25', 'text/csv');
    case 'm4.alerts.scan':
      return jsonResponse({ scanned: 1, created: 1 });
    case 'm4.alerts.list':
      return jsonResponse(page(m4Alert));
    case 'm4.alerts.urge-message':
      return jsonResponse({ alert_id: 701, urge_message: '请尽快反馈', channel: 'wechat' });
    case 'm4.alerts.export-csv':
      return textResponse('alert_type,purchase_order_no\noverdue,PO-001', 'text/csv');
    case 'm4.alerts.status.update':
      return jsonResponse({ ...m4Alert, status: 'processing' });
    case 'm5.schedules.create':
    case 'm5.schedules.get':
    case 'm5.schedules.intelligent':
      return jsonResponse(m5Schedule);
    case 'm5.facade.schedule-board':
      return callIndex === 0 ? jsonResponse([m5Schedule]) : jsonResponse(m5Schedule);
    case 'm5.facade.schedule-dependencies':
      return callIndex === 0
        ? jsonResponse([m5Schedule])
        : jsonResponse([{ id: 'DEP-1', predecessorId: 'SCH-1', successorId: 'SCH-2', type: 'finish_to_start', lagDays: 0 }]);
    case 'm5.facade.schedule-events':
      return jsonResponse([{
        id: 'EV-1',
        sequence: 1,
        base_plan_version: 'PV-001',
        new_plan_version: 'PV-002',
        event_type: 'schedule_created',
        source: 'cp-sat',
        occurred_at: '2026-07-10T08:00:00Z',
        severity: 'info',
        reason: 'contract fixture',
        payload: {},
        created_at: '2026-07-10T08:00:00Z',
      }]);
    case 'm5.facade.replan-from-version':
      return jsonResponse({ plan_version: 'PV-002', status: 'solved' });
    case 'm5.schedules.list':
      return jsonResponse([m5Schedule]);
    case 'm5.operations.update':
    case 'm5.facade.adjust-task':
      return jsonResponse(m5Schedule.operations[0]);
    case 'm5.operations.lock':
      return jsonResponse({ ...m5Schedule.operations[0], locked: true });
    case 'm5.operations.unlock':
      return jsonResponse({ ...m5Schedule.operations[0], locked: false });
    case 'm5.schedules.dispatch':
      return jsonResponse({ plan_version: 'PV-001', status: 'dispatched' });
    case 'm5.schedules.feedback':
      return jsonResponse({ plan_version: 'PV-001', action: 'approve', lifecycle_status: 'approved' });
    case 'm5.execution-events.create':
      return jsonResponse({ event_id: 'EVT-001', accepted: true });
    case 'm5.execution-summary.get':
      return jsonResponse({
        plan_version: 'PV-001',
        event_count: 2,
        latest_event_at: '2026-07-29T08:10:00Z',
        average_start_deviation_minutes: 0,
        average_end_deviation_minutes: 5,
        max_abs_end_deviation_minutes: 5,
        late_operation_count: 1,
        exception_count: 0,
        scrap_quantity: 0,
        planned_operation_count: 4,
        started_operation_count: 2,
        completed_operation_count: 1,
        paused_operation_count: 1,
        exception_operation_count: 0,
        completion_rate_percent: 25,
        source_event_counts: { mes: 2 },
      });
    case 'm5.pmc.progress':
      return jsonResponse({
        plan_version: 'PV-001',
        generated_at: '2026-08-20T08:30:00Z',
        summary: {
          order_count: 1,
          completed_order_count: 0,
          wip_order_count: 1,
          late_order_count: 0,
          on_time_order_count: 0,
          on_time_rate_percent: null,
        },
        orders: [{
          order_id: 'ORD-001',
          product_id: 'PROD-001',
          planned_quantity: 10,
          unit: 'pcs',
          due_time: null,
          actual_qty: 3,
          actual_quantity_supported: true,
          terminal_operation_id: 'OP-001',
          completion_rate_percent: 30,
          status: 'wip',
          on_time: null,
          planned_completion_time: '2026-08-20T09:00:00Z',
          actual_completion_time: null,
          operations: [{
            order_id: 'ORD-001',
            product_id: 'PROD-001',
            operation_id: 'OP-001',
            operation_name: '切割',
            resource_id: 'line-1',
            planned_start_time: '2026-08-20T08:00:00Z',
            planned_end_time: '2026-08-20T09:00:00Z',
            planned_quantity: 10,
            unit: 'pcs',
            actual_start_time: '2026-08-20T08:05:00Z',
            actual_end_time: null,
            actual_qty: 3,
            actual_status: 'running',
            completion_rate_percent: 30,
          }],
        }],
      });
    case 'm5.leader.teams.list':
      return jsonResponse([
        {
          team_id: 'TEAM-A1',
          team_code: 'TEAM-A1',
          team_name: '一车间 A 班',
          leader_user_id: 'leader-zhang',
          line_id: null,
          resource_ids: ['EQ-CUT'],
          shift_rule: {},
          status: 'active',
          created_at: '2026-08-10T00:00:00Z',
          updated_at: '2026-08-10T00:00:00Z',
        },
      ]);
    case 'm5.leader.teams.create':
    case 'm5.leader.teams.get':
      return jsonResponse({
        team_id: 'TEAM-A1',
        team_code: 'TEAM-A1',
        team_name: '一车间 A 班',
        leader_user_id: 'leader-zhang',
        line_id: null,
        resource_ids: ['EQ-CUT'],
        shift_rule: {},
        status: 'active',
        created_at: '2026-08-10T00:00:00Z',
        updated_at: '2026-08-10T00:00:00Z',
      });
    case 'm5.leader.members.list':
      return jsonResponse([
        {
          id: 'member-1',
          team_id: 'TEAM-A1',
          worker_id: 'worker-wang',
          worker_name: '王师傅',
          station: '押出机 01',
          role: 'worker',
          status: 'active',
          created_at: '2026-08-10T00:00:00Z',
          updated_at: '2026-08-10T00:00:00Z',
        },
      ]);
    case 'm5.leader.members.create':
      return jsonResponse({
        id: 'member-2',
        team_id: 'TEAM-A1',
        worker_id: 'worker-li',
        worker_name: '李师傅',
        station: null,
        role: 'worker',
        status: 'active',
        created_at: '2026-08-10T00:00:00Z',
        updated_at: '2026-08-10T00:00:00Z',
      });
    case 'm5.leader.today-tasks.get':
      return jsonResponse([
        {
          plan_version: 'PV-001',
          order_id: 'SO-LEADER-001',
          product_id: 'SKU-L',
          order_quantity: 500,
          operation_id: 'OP-10',
          operation_name: '押出',
          resource_id: 'EQ-CUT',
          resource_name: '押出机 01',
          start_time: '2026-08-10T00:00:00Z',
          end_time: '2026-08-10T02:00:00Z',
          planned_minutes: 120,
          schedule_status: 'scheduled',
          progress_state: 'not_started',
          reported_quantity: 0,
          scrap_quantity: 0,
          ledger_entry_count: 0,
        },
      ]);
    case 'm5.leader.bindings.list':
      return jsonResponse([
        {
          id: 'binding-1',
          worker_id: 'worker-wang',
          order_id: 'SO-LEADER-001',
          team_id: 'TEAM-A1',
          leader_user_id: 'leader-zhang',
          resource_id: 'EQ-CUT',
          station: '押出机 01',
          role: 'worker',
          status: 'active',
          created_at: '2026-08-10T00:00:00Z',
          updated_at: '2026-08-10T00:00:00Z',
        },
      ]);
    case 'm5.leader.bindings.create':
      return jsonResponse([
        {
          id: 'binding-1',
          worker_id: 'worker-wang',
          order_id: 'SO-LEADER-001',
          team_id: 'TEAM-A1',
          leader_user_id: 'leader-zhang',
          resource_id: null,
          station: null,
          role: 'worker',
          status: 'active',
          created_at: '2026-08-10T00:00:00Z',
          updated_at: '2026-08-10T00:00:00Z',
        },
      ]);
    case 'm5.leader.bindings.delete':
      return jsonResponse({
        id: 'binding-1',
        worker_id: 'worker-wang',
        order_id: 'SO-LEADER-001',
        team_id: 'TEAM-A1',
        leader_user_id: 'leader-zhang',
        resource_id: null,
        station: null,
        role: 'worker',
        status: 'closed',
        created_at: '2026-08-10T00:00:00Z',
        updated_at: '2026-08-10T00:00:00Z',
      });
    case 'm5.worker.tasks.list':
      return jsonResponse([
        {
          binding_id: 'binding-1',
          worker_id: 'worker-wang',
          team_id: 'TEAM-A1',
          leader_user_id: 'leader-zhang',
          station: '押出机 01',
          plan_version: 'PV-001',
          tracking_task_id: 'task-plan-001',
          order_id: 'SO-LEADER-001',
          product_id: 'SKU-L',
          operation_id: 'OP-10',
          operation_name: '押出',
          resource_id: 'EQ-CUT',
          resource_name: '押出机 01',
          planned_start_time: '2026-08-10T00:00:00Z',
          planned_end_time: '2026-08-10T02:00:00Z',
          actual_status: 'running',
          unit: 'pcs',
        },
      ]);
    case 'm5.worker.report.create':
      return jsonResponse({
        id: 'ledger-001',
        plan_version: 'PV-001',
        order_id: 'SO-LEADER-001',
        operation_id: 'OP-10',
        operation_name: '押出',
        resource_id: 'EQ-CUT',
        resource_name: '押出机 01',
        product_id: 'SKU-L',
        team_id: 'TEAM-A1',
        team_name: '一车间 A 班',
        leader_user_id: 'leader-zhang',
        worker_id: 'worker-wang',
        worker_name: '王师傅',
        station: '押出机 01',
        execution_event_id: null,
        fact_ref: null,
        planned_min: null,
        actual_min: 360,
        qty_reported: 300,
        qty_scrap: 0,
        shift_date: '2026-08-10',
        status: 'reported',
        params: {},
        created_at: '2026-08-10T00:00:00Z',
        updated_at: '2026-08-10T00:00:00Z',
      });
    case 'm5.worker.order-operations.list':
      return jsonResponse({
        order_id: 'SO-LEADER-001',
        items: [
          {
            order_id: 'SO-LEADER-001',
            operation_id: 'OP-10',
            operation_name: '押出',
            resource_id: 'EQ-CUT',
            plan_version: 'PV-001',
            start_time: '2026-08-10T00:00:00Z',
          },
          {
            order_id: 'SO-LEADER-001',
            operation_id: 'OP-20',
            operation_name: '绞线',
            resource_id: 'EQ-TWIST',
            plan_version: 'PV-001',
            start_time: '2026-08-10T02:00:00Z',
          },
        ],
        count: 2,
      });
    case 'm5.leader.report.create':
      return jsonResponse({
        id: 'ledger-001',
        plan_version: 'PV-001',
        order_id: 'SO-LEADER-001',
        operation_id: 'OP-10',
        operation_name: '押出',
        resource_id: 'EQ-CUT',
        resource_name: '押出机 01',
        product_id: 'SKU-L',
        team_id: 'TEAM-A1',
        team_name: '一车间 A 班',
        leader_user_id: 'leader-zhang',
        worker_id: 'worker-wang',
        worker_name: '王师傅',
        station: '押出机 01',
        execution_event_id: 'EVT-001',
        fact_ref: null,
        planned_min: 120,
        actual_min: null,
        qty_reported: 0,
        qty_scrap: 0,
        shift_date: '2026-08-10',
        status: 'running',
        params: {},
        created_at: '2026-08-10T00:00:00Z',
        updated_at: '2026-08-10T00:00:00Z',
      });
    case 'm5.leader.workload.query':
    case 'm5.leader.orders.workload':
      return jsonResponse({
        items: [],
        total: 0,
        total_planned_min: 0,
        total_actual_min: 0,
        total_qty_reported: 0,
        total_qty_scrap: 0,
        worker_count: 0,
      });
    case 'm5.leader.workload.comparison':
      return jsonResponse({
        items: [],
        total_planned_min: 0,
        total_actual_min: 0,
        total_variance_min: 0,
        total_qty_reported: 0,
        total_qty_scrap: 0,
      });
    case 'm5.piece-wage.daily':
      return jsonResponse({
        shift_date: '2026-08-20',
        total: 0,
        line_count: 0,
        lines: [],
        summary_by_worker: [],
        summary_by_order: [],
        summary_by_station: [],
        missing_rate: [],
      });
    case 'm5.piece-wage.rates':
      return jsonResponse({ items: [], count: 0 });
    case 'qc.dashboard':
      return jsonResponse({
        telemetry_total: 0,
        quality_total: 0,
        sources: [],
        quality_by_stage: {},
        recent_events: [],
      });
    case 'qc.telemetry.query':
      return jsonResponse({ total: 0, items: [] });
    case 'm7.delivery-notes.list':
    case 'm7.inspections.pending':
    case 'm7.inventory.query':
    case 'm7.material-issues.list':
      return jsonResponse(envelope([]));
    case 'm7.inventory.allocate':
    case 'm7.inventory.allocation-release':
      return jsonResponse(envelope({
        allocation_id: 'allocation-1', inventory_balance_id: 'balance-1', warehouse_id: 'WH-01', material_id: 'MAT-1',
        material_code: 'MAT-1', batch_no: 'LOT-1', uom: 'pcs', order_id: 'SO-1', quantity_allocated: '4',
        quantity_consumed: '0', quantity_remaining: '4', status: 'active', tracking_task_id: 'task_m7_contract',
      }));
    case 'm7.delivery-notes.create':
    case 'm7.delivery-notes.sign':
      return jsonResponse(envelope({ delivery_note_id: 'dn-1', delivery_note_number: 'DN-1', supplier_id: 'SUP-1', purchase_order_id: '1', order_id: 'SO-1', warehouse_id: 'WH-01', status: 'draft', tracking_task_id: 'task_m7_contract', items: [] }));
    case 'm7.delivery-notes.scan':
      return jsonResponse(envelope({ m0_batch_id: 'batch-1', suggested: { delivery_note_number: 'DN-1' }, missing_fields: [], requires_human_review: true }));
    case 'm7.inspections.sample':
    case 'm7.inspections.confirm':
      return jsonResponse(envelope({ inspection_lot_id: 'insp-1', delivery_note_id: 'dn-1', material_code: 'MAT-1', batch_no: 'LOT-1', lot_quantity: '10', recommended_sample_quantity: '1', sampling_rule: 'default_rate:0.1', status: 'sampling', tracking_task_id: 'task_m7_contract' }));
    case 'm7.material-issues.create':
    case 'm7.material-issues.over':
    case 'm7.material-issues.approve':
      return jsonResponse(envelope({ material_issue_id: 'issue-1', issue_number: 'MI-1', order_id: 'SO-1', issue_type: 'normal', status: 'executed', tracking_task_id: 'task_m7_contract', requested_by: 'tester', items: [] }));
    case 'm5.schedule-jobs.create':
    case 'm5.ops-jobs.get':
      return jsonResponse({ job_id: 'm5-job-001', status: 'done' });
    case 'm5.ops.flow-dashboard':
      return jsonResponse(envelope([]));
    case 'm5.snapshots.import':
      return jsonResponse({ scenario_id: 'SCN-001' });
    case 'm5.snapshots.readiness':
      return jsonResponse({ scenario_id: 'SCN-001', items: [] });
    case 'm5.materials.procurement-plan':
      return jsonResponse({ plan_id: 'MAT-PLAN-001' });
    case 'm6.health':
      return jsonResponse(envelope({ status: 'ok' }));
    case 'm6.finance.cost':
      return jsonResponse(envelope({ total_cost: '12800.00' }));
    case 'm6.finance.bom.import':
      return jsonResponse(envelope({ import_id: 'M6-IMP-001', status: 'accepted' }));
    case 'm8.health':
      return jsonResponse({ status: 'ok' });
    case 'm8.projects.create':
    case 'm8.projects.get':
      return jsonResponse(m8Project, item.id === 'm8.projects.create' ? 201 : 200);
    case 'm8.messages.send':
    case 'm8.runs.get':
      return jsonResponse(m8Run);
    case 'm8.human-decisions.submit':
      return jsonResponse({ accepted: true });
    case 'm8.outputs.json':
      return jsonResponse({ key: 'summary', value: 'mock output' });
    case 'm8.outputs.text':
      return textResponse('mock output');
    case 'm8.cad.contract':
      return jsonResponse({ version: 'mock-contract-v1', status: 'not_implemented' });
    case 'm8.cad.request':
      return jsonResponse({ code: 'not_implemented', message: 'CAD drawing agent is not implemented' }, 501);
    case 'demo.bom.items.list':
      return jsonResponse([demoBomItem]);
    case 'demo.bom.items.review':
      return jsonResponse({ ...demoBomItem, status: 'approved' });
    case 'demo.sop.steps':
      return jsonResponse([demoSopStep]);
    case 'demo.purchase.warnings.list':
      return jsonResponse([demoPurchaseWarning]);
    case 'demo.purchase.warnings.follow':
      return jsonResponse({ ...demoPurchaseWarning, status: 'followed' });
    case 'demo.legal.risks.list':
      return jsonResponse([demoLegalRisk]);
    case 'demo.legal.risks.final-review':
      return jsonResponse({ ...demoLegalRisk, status: 'approved' });
    case 'demo.notifications.list':
      return jsonResponse([demoNotification]);
    default:
      throw new Error(`Missing response fixture for ${item.id}`);
  }
};

const metadata = { source: 'manual' as const, documentType: 'drawing' as const, priority: 'normal' as const };
const file = new File(['contract'], 'contract.pdf', { type: 'application/pdf' });
const archive = new File(['zip'], 'archive.zip', { type: 'application/zip' });
const businessFlowRequest: businessFlowRunApi.BusinessFlowCreateRequest = {
  idempotency_key: 'business:contract:001',
  order_id: 'ORD-CONTRACT-001',
  order_number: 'SO-CONTRACT-001',
  mode: 'real',
  order_type: 'normal',
  m1_options: { semantic_enrichment: false },
  m2_payload: null,
  m3_payload: null,
  m4_payload: {},
  m4_generate_payload: null,
  m5_payload: null,
  replace_m3_bom_with_m2: true,
  session_id: 'business-contract',
};

const expectJsonBody = (expected: unknown) => (init: RequestInit) => {
  expect(JSON.parse(String(init.body))).toEqual(expected);
};

const expectFormData = (init: RequestInit) => {
  expect(init.body).toBeInstanceOf(FormData);
  expect(new Headers(init.headers).has('Content-Type')).toBe(false);
};

const noBody = (init: RequestInit) => {
  expect(init.body).toBeUndefined();
};

const contractCases: Record<string, ContractCase> = {
  'business-trace.order-trace': {
    call: () => businessTraceApi.getBusinessOrderTrace('SO-1'),
    expectedUrl: '/api/orchestrator/business-orders/SO-1/trace',
  },
  'business-trace.flow-trace': {
    call: () => businessTraceApi.getBusinessFlowTrace('flow-abc123'),
    expectedUrl: '/api/orchestrator/business-flows/flow-abc123/trace',
  },
  'business-trace.material-trace': {
    call: () => businessTraceApi.getBusinessMaterialTrace('MAT-1'),
    expectedUrl: '/api/orchestrator/business-materials/MAT-1/trace',
  },
  'business-trace.cost-variance': {
    call: () => businessTraceApi.getBusinessCostVariance('2026-08'),
    expectedUrl: '/api/orchestrator/business-cost-variance?period=2026-08',
  },
  'business-trace.finished-goods': {
    call: () => businessTraceApi.getBusinessFinishedGoods(),
    expectedUrl: '/api/orchestrator/business-finished-goods',
  },
  'business-trace.consumption-variance': {
    call: () =>
      businessTraceApi.getBusinessConsumptionVariance({
        orderId: 'SO-1',
        materialCode: 'MAT-1',
      }),
    expectedUrl:
      '/api/orchestrator/business-consumption-variance?order_id=SO-1&material_code=MAT-1',
  },
  'business-trace.consumption-variance-refresh': {
    call: () => businessTraceApi.refreshBusinessConsumptionVariance('SO-1'),
    expectedUrl: '/api/orchestrator/business-consumption-variance/refresh',
  },
  'business-trace.order-outbound-flow': {
    call: () => businessTraceApi.getBusinessOrderOutboundFlow('SO-1'),
    expectedUrl: '/api/orchestrator/business-orders/SO-1/outbound-flow',
  },
  'business-trace.flow-outbound-flow': {
    call: () => businessTraceApi.getBusinessFlowOutboundFlow('flow-abc123'),
    expectedUrl: '/api/orchestrator/business-flows/flow-abc123/outbound-flow',
  },
  'business-trace.inspect-finished-goods': {
    call: () =>
      businessTraceApi.inspectFinishedGoods({
        materialId: 'FG-1',
        orderId: 'SO-1',
        quantity: 3,
      }),
    expectedUrl: '/api/orchestrator/business-facts',
  },
  'business-trace.publish-fact': {
    call: () =>
      businessTraceApi.publishBusinessFact({
        fact_type: 'receipt',
        aggregate_type: 'material',
        aggregate_id: 'MAT-1',
        source_module: 'm4',
        source_event_id: 'contract-receipt',
        payload: {
          material_id: 'MAT-1',
          order_id: 'SO-1',
          purchase_order_id: 'PO-1',
          location_id: 'WH-1',
          quantity: '3',
        },
      }),
    expectedUrl: '/api/orchestrator/business-facts',
  },
  'business-trace.execution-output': {
    call: () =>
      businessTraceApi.publishExecutionOutput({
        order_id: 'SO-1',
        location_id: 'FG-WH',
        execution_event: {
          event_type: 'actual_finish',
          event_id: 'contract-finish',
          source: 'mes',
          reported_quantity: 3,
        },
      }),
    expectedUrl: '/api/orchestrator/business-execution-outputs',
  },
  'evidence.m3.review': { call: () => evidenceApi.listEvidenceReviewQueue('m3'), expectedUrl: '/api/m3/evidence/review-queue?limit=50' },
  'evidence.m3.detail': { call: () => evidenceApi.getEvidenceBatch('m3', 'EV-BATCH-1'), expectedUrl: '/api/m3/evidence/batch/EV-BATCH-1' },
  'evidence.m3.history': { call: () => evidenceApi.listEvidenceAudit('m3', 'EV-BATCH-1'), expectedUrl: '/api/m3/evidence/history?batch_id=EV-BATCH-1&limit=100' },
  'evidence.m3.resolve': { call: () => evidenceApi.resolveEvidenceRow('m3', 'EV-BATCH-1', 'EV-ROW-1', 'accept', '已核对'), expectedUrl: '/api/m3/evidence/batch/EV-BATCH-1/resolve/EV-ROW-1', assertRequest: expectJsonBody({ decision: 'accept', note: '已核对' }) },
  'evidence.m3.commit': { call: () => evidenceApi.commitEvidenceBatch('m3', 'EV-BATCH-1'), expectedUrl: '/api/m3/evidence/batch/EV-BATCH-1/commit' },
  'evidence.m4.review': { call: () => evidenceApi.listEvidenceReviewQueue('m4'), expectedUrl: '/api/m4/evidence/batches?state=actionable&limit=50' },
  'evidence.m4.detail': { call: () => evidenceApi.getEvidenceBatch('m4', 'EV-BATCH-1'), expectedUrl: '/api/m4/evidence/batch/EV-BATCH-1' },
  'evidence.m4.history': { call: () => evidenceApi.listEvidenceAudit('m4', 'EV-BATCH-1'), expectedUrl: '/api/m4/evidence/history?batch_id=EV-BATCH-1&limit=100' },
  'evidence.m4.resolve': { call: () => evidenceApi.resolveEvidenceRow('m4', 'EV-BATCH-1', 'EV-ROW-1', 'accept', '已核对'), expectedUrl: '/api/m4/evidence/batch/EV-BATCH-1/resolve/EV-ROW-1', assertRequest: expectJsonBody({ decision: 'accept', note: '已核对' }) },
  'evidence.m4.commit': { call: () => evidenceApi.commitEvidenceBatch('m4', 'EV-BATCH-1'), expectedUrl: '/api/m4/evidence/batch/EV-BATCH-1/commit' },
  'evidence.m5.review': { call: () => evidenceApi.listEvidenceReviewQueue('m5'), expectedUrl: '/api/m5/evidence/review-queue?limit=50' },
  'evidence.m5.detail': { call: () => evidenceApi.getEvidenceBatch('m5', 'EV-BATCH-1'), expectedUrl: '/api/m5/evidence/batch/EV-BATCH-1' },
  'evidence.m5.history': { call: () => evidenceApi.listEvidenceAudit('m5', 'EV-BATCH-1'), expectedUrl: '/api/m5/evidence/history?batch_id=EV-BATCH-1&limit=100' },
  'evidence.m5.resolve': { call: () => evidenceApi.resolveEvidenceRow('m5', 'EV-BATCH-1', 'EV-ROW-1', 'accept', '已核对'), expectedUrl: '/api/m5/evidence/batch/EV-BATCH-1/resolve/EV-ROW-1', assertRequest: expectJsonBody({ decision: 'accept', note: '已核对' }) },
  'evidence.m5.commit': { call: () => evidenceApi.commitEvidenceBatch('m5', 'EV-BATCH-1'), expectedUrl: '/api/m5/evidence/batch/EV-BATCH-1/commit' },
  'gateway.dashboard.summary': {
    call: () => dashboardApi.getDashboardSummary(),
    expectedUrl: ['/api/m0/parser-compat/health', '/api/m2/health', '/api/m3/health', '/api/m4/health', '/api/m5/health'],
  },
  'gateway.dashboard.module-statuses': { call: () => moduleApi.getModuleStatuses(), expectedUrl: '/api/dashboard/module-statuses' },
  'gateway.tasks.list': { call: () => taskApi.getTasks(), expectedUrl: '/api/tasks' },
  'gateway.tasks.update': {
    call: () => taskApi.updateTask('TASK-1', { status: 'completed' }),
    expectedUrl: '/api/tasks/TASK-1',
    assertRequest: expectJsonBody({ status: 'completed' }),
  },
  'orchestrator.agent-tasks.list': {
    call: () => taskApi.getAgentTasks({ includeDismissed: true }),
    expectedUrl: '/api/orchestrator/tasks?include_dismissed=true',
  },
  'orchestrator.agent-tasks.history': {
    call: () => taskApi.getAgentTasks({ agent: 'm1', includeHistory: true, historyLimit: 50 }),
    expectedUrl: '/api/orchestrator/tasks?include_dismissed=true&agent=m1&include_history=true&history_limit=50',
  },
  'orchestrator.agent-tasks.reminder': {
    call: () => taskApi.updateAgentTaskReminder(agentTask.id, 'dismiss'),
    expectedUrl: '/api/orchestrator/tasks/flow%3AFLOW-CONTRACT-001%3Aresolve_or_generate_bom%3A1',
    assertRequest: expectJsonBody({ action: 'dismiss' }),
  },
  'gateway.audit.logs.list': { call: () => auditApi.getAuditLogs(), expectedUrl: '/api/audit/logs' },
  'gateway.audit.logs.write': {
    call: () => auditApi.writeAuditLog(auditLog),
    expectedUrl: '/api/audit/logs',
    assertRequest: expectJsonBody(auditLog),
  },
  'gateway.auth.me': {
    call: () => {
      vi.stubEnv('VITE_ENABLE_MSW', 'false');
      return permissionApi.getCurrentRole();
    },
    expectedUrl: '/api/auth/me',
  },
  'gateway.flow.agent': {
    call: () => flowApi.getAgentFlow(),
    expectedUrl: ['/api/m0/parser-compat/health', '/api/m2/health', '/api/m3/health', '/api/m4/health', '/api/m5/health'],
  },
  'gateway.flow.agent-from-job': { call: () => flowApi.getAgentFlowFromJob('orch-job-001'), expectedUrl: '/api/orchestrator/jobs/orch-job-001' },
  'gateway.workbench.activities': {
    call: () => activityApi.getWorkbenchActivities(),
    expectedUrl: [
      '/api/audit/logs',
      '/api/m0/parser-compat/health',
      '/api/m2/health',
      '/api/m3/health',
      '/api/m4/health',
      '/api/m5/health',
      '/api/m5/ops/flow-dashboard?limit=20',
    ],
  },
  'orchestrator.health': { call: () => orchestratorApi.getOrchestratorHealth(), expectedUrl: '/api/orchestrator/health' },
  'orchestrator.business-flows.create': {
    call: () => businessFlowRunApi.createBusinessFlow(businessFlowRequest, 'task_contract_001'),
    expectedUrl: '/api/orchestrator/business-flows',
    assertRequest: (init) => {
      expectJsonBody(businessFlowRequest)(init);
      expect(new Headers(init.headers).get('X-Yunpai-Task-ID')).toBe('task_contract_001');
    },
  },
  'orchestrator.business-flows.get': {
    call: () => businessFlowRunApi.getBusinessFlow('FLOW-CONTRACT-001'),
    expectedUrl: '/api/orchestrator/business-flows/FLOW-CONTRACT-001',
  },
  'orchestrator.business-flows.resume': {
    call: () => businessFlowRunApi.resumeBusinessFlowRequest('FLOW-CONTRACT-001'),
    expectedUrl: '/api/orchestrator/business-flows/FLOW-CONTRACT-001/resume',
    assertRequest: expectJsonBody({ action: 'continue' }),
  },
  'orchestrator.business-orders.trace': {
    call: () => businessFlowRunApi.getBusinessOrderTrace('ORD-CONTRACT-001'),
    expectedUrl: '/api/orchestrator/business-orders/ORD-CONTRACT-001/trace',
  },
  'orchestrator.business-flows.trace': {
    call: () => businessFlowRunApi.getBusinessFlowTrace('flow-abc123'),
    expectedUrl: '/api/orchestrator/business-flows/flow-abc123/trace',
  },
  'orchestrator.business-tasks.trace': {
    call: () => businessFlowRunApi.getBusinessTaskTrace('task_contract_001'),
    expectedUrl: '/api/orchestrator/business-tasks/task_contract_001/trace',
  },
  'orchestrator.invoke': {
    call: () => orchestratorApi.invokeAgent({ task: 'contract check', session_id: 'session-1' }),
    expectedUrl: '/api/orchestrator/invoke',
    assertRequest: expectJsonBody({ task: 'contract check', session_id: 'session-1' }),
  },
  'orchestrator.job.get': { call: () => orchestratorApi.getJob('orch-job-001'), expectedUrl: '/api/orchestrator/jobs/orch-job-001' },
  'orchestrator.jobs.list': {
    call: () => orchestratorApi.listJobs({ session_id: 'session 1', limit: 5 }),
    expectedUrl: '/api/orchestrator/jobs?session_id=session+1&limit=5',
  },
  'orchestrator.memory.similar': {
    call: () => orchestratorApi.searchSimilarMemory({ task: '排程 风险', top_k: 3 }),
    expectedUrl: '/api/orchestrator/memory/similar?task=%E6%8E%92%E7%A8%8B+%E9%A3%8E%E9%99%A9&top_k=3',
  },
  'orchestrator.tracking.snapshot': {
    call: () => trackingSnapshotApi.getTrackingSnapshot('task_contract_001'),
    expectedUrl: '/api/orchestrator/tracking/tasks/task_contract_001/snapshot',
  },
  'orchestrator.chat.stream': {
    call: async () => {
      const events: unknown[] = [];
      for await (const event of chatApi.streamChatFromOrchestrator({ message: 'contract check', session_id: 'session-1' })) {
        events.push(event);
      }
      return events;
    },
    expectedUrl: '/api/orchestrator/chat/stream',
    assertRequest: (init) => {
      expect(new Headers(init.headers).get('Accept')).toBe('application/x-ndjson');
      expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
      expect(JSON.parse(String(init.body))).toMatchObject({
        message: 'contract check',
        session_id: 'session-1',
        use_memory: true,
        tools: [],
        context: { page: 'assistant' },
      });
      expect(JSON.parse(String(init.body)).client_message_id).toBeTruthy();
    },
  },
  'orchestrator.chat.conversations.list': {
    call: () => chatApi.listChatConversations('risk review'),
    expectedUrl: '/api/orchestrator/chat/conversations?q=risk%20review',
  },
  'orchestrator.chat.conversations.create': {
    call: () => chatApi.createChatConversation('New conversation'),
    expectedUrl: '/api/orchestrator/chat/conversations',
    assertRequest: expectJsonBody({ title: 'New conversation' }),
  },
  'orchestrator.chat.messages.list': {
    call: () => chatApi.getChatMessages('11111111-1111-4111-8111-111111111111'),
    expectedUrl: '/api/orchestrator/chat/conversations/11111111-1111-4111-8111-111111111111/messages',
  },
  'orchestrator.chat.messages.local-assistant': {
    call: () => chatApi.createLocalAssistantMessage(
      '11111111-1111-4111-8111-111111111111',
      '识别完成',
      { kind: 'm7_delivery_draft', draft: null },
      '33333333-3333-4333-8333-333333333333',
    ),
    expectedUrl: '/api/orchestrator/chat/conversations/11111111-1111-4111-8111-111111111111/local-assistant-messages',
    assertRequest: expectJsonBody({
      content: '识别完成',
      client_message_id: '33333333-3333-4333-8333-333333333333',
      source: 'm7_delivery_workflow',
      structured_data: { kind: 'm7_delivery_draft', draft: null },
    }),
  },
  'orchestrator.chat.conversations.rename': {
    call: () => chatApi.renameChatConversation('11111111-1111-4111-8111-111111111111', 'Renamed', 2),
    expectedUrl: '/api/orchestrator/chat/conversations/11111111-1111-4111-8111-111111111111',
    assertRequest: expectJsonBody({ title: 'Renamed', version: 2 }),
  },
  'orchestrator.chat.conversations.delete': {
    call: () => chatApi.deleteChatConversation('11111111-1111-4111-8111-111111111111', 2),
    expectedUrl: '/api/orchestrator/chat/conversations/11111111-1111-4111-8111-111111111111',
    assertRequest: (init) => { expect(init.method).toBe('DELETE'); expect(new Headers(init.headers).get('If-Match')).toBe('2'); },
  },
  'orchestrator.chat.follow-ups': {
    call: () => chatApi.requestFollowUps({ message: '检查排程', conversation: [{ role: 'user', content: '检查排程' }] }),
    expectedUrl: '/api/orchestrator/chat/follow-ups',
    assertRequest: expectJsonBody({ message: '检查排程', conversation: [{ role: 'user', content: '检查排程' }] }),
  },
  'm0.import.upload': {
    call: () => m0Api.uploadM0Files([file], { trackingTaskId: 'task_contract_m0_001' }),
    expectedUrl: '/api/m0/import/upload?wait=false',
    assertRequest: (init) => {
      expectFormData(init);
      expect(new Headers(init.headers).get('X-Yunpai-Task-ID')).toBe('task_contract_m0_001');
    },
  },
  'm0.import.batches.list': {
    call: () => m0Api.listM0Batches(5, 10),
    expectedUrl: '/api/m0/import/batches?limit=5&offset=10',
  },
  'm0.import.batch.detail': {
    call: () => m0Api.getM0BatchDetail('B-M0-1'),
    expectedUrl: '/api/m0/import/batch/B-M0-1',
  },
  'm0.import.master': {
    call: () => m0Api.listM0Master('yield', 8),
    expectedUrl: '/api/m0/import/master/yield?limit=8',
  },
  'm0.import.master.update': {
    call: () => m0Api.updateM0MasterRow('m0_master_machine', 5, { machine_name: '注塑机（改）' }),
    expectedUrl: '/api/m0/import/master/m0_master_machine/5',
    assertRequest: expectJsonBody({ values: { machine_name: '注塑机（改）' } }),
  },
  'm0.import.master.create': {
    call: () => m0Api.createM0MasterRow('m0_master_machine', { machine_code: 'M-099', machine_name: '新设备' }),
    expectedUrl: '/api/m0/import/master/m0_master_machine',
    assertRequest: expectJsonBody({ values: { machine_code: 'M-099', machine_name: '新设备' } }),
  },
  'm0.import.master.delete': {
    call: () => m0Api.deleteM0MasterRow('m0_master_machine', 5),
    expectedUrl: '/api/m0/import/master/m0_master_machine/5',
  },
  'm0.import.extract.retry': {
    call: () => m0Api.retryM0Extraction('B-M0-1'),
    expectedUrl: '/api/m0/import/batch/B-M0-1/extract/retry',
  },
  'm0.import.batch.preview': {
    call: () => m0Api.previewM0Batch('B-M0-1'),
    expectedUrl: '/api/m0/import/batch/B-M0-1/preview',
  },
  'm0.import.batch.resolve-entity': {
    call: () => m0Api.resolveM0Entity('B-M0-1', 1, 'approve', '已核对实体别名等价'),
    expectedUrl: '/api/m0/import/batch/B-M0-1/resolve/entity',
    assertRequest: expectJsonBody({ entity_id: 1, action: 'approve', decision_reason: '已核对实体别名等价' }),
  },
  'm0.import.batch.resolve-document': {
    call: () => m0Api.resolveM0Document('B-M0-1', 3, 'approve'),
    expectedUrl: '/api/m0/import/batch/B-M0-1/resolve/document',
    assertRequest: expectJsonBody({ document_id: 3, action: 'approve' }),
  },
  'm0.import.batch.resolve-mapping': {
    call: () => m0Api.resolveM0Mapping('B-M0-1', 2, 'reject', '', '缺少唯一可信库存目标'),
    expectedUrl: '/api/m0/import/batch/B-M0-1/resolve/mapping',
    assertRequest: expectJsonBody({
      mapping_id: 2,
      action: 'reject',
      target_ref: '',
      decision_reason: '缺少唯一可信库存目标',
    }),
  },
  'm0.import.batch.commit': {
    call: () => m0Api.commitM0Batch('B-M0-1'),
    expectedUrl: '/api/m0/import/batch/B-M0-1/commit',
  },
  'm0.import.batch.rollback': {
    call: () => m0Api.rollbackM0Batch('B-M0-1'),
    expectedUrl: '/api/m0/import/batch/B-M0-1/rollback',
  },
  'm0.import.quarantine.list': {
    call: () => m0Api.listM0Quarantine('B-M0-1', 20),
    expectedUrl: '/api/m0/import/quarantine?batch_id=B-M0-1&limit=20',
  },
  'm0.master.inventory.list': {
    call: () => m0Api.listM0Inventory(10, 20, 'MAT-001'),
    expectedUrl: '/api/m0/import/master/m0_master_inventory?limit=10&offset=20&material_code=MAT-001',
  },
  'm0.documents.list': {
    call: () => m0DocumentsApi.listM0Documents({ material: 'CABLE-2M', doc_type: 'engineering_drawing' }),
    expectedUrl: '/api/m0/documents?material=CABLE-2M&doc_type=engineering_drawing',
  },
  'm0.documents.bindings.create': {
    call: () =>
      m0DocumentsApi.bindM0Document(1, [
        { entity_type: 'material', entity_id: 'CABLE-2M', entity_name: 'HDMI 线材 2M', stage: '押出' },
      ]),
    expectedUrl: '/api/m0/documents/1/bindings',
    assertRequest: expectJsonBody({
      bindings: [
        { entity_type: 'material', entity_id: 'CABLE-2M', entity_name: 'HDMI 线材 2M', stage: '押出' },
      ],
    }),
  },
  'm0.documents.bindings.list': {
    call: () => m0DocumentsApi.listM0DocumentBindings(1),
    expectedUrl: '/api/m0/documents/1/bindings',
  },
  'm0.documents.bindings.delete': {
    call: () => m0DocumentsApi.deleteM0DocumentBinding(7),
    expectedUrl: '/api/m0/documents/bindings/7',
    assertRequest: noBody,
  },
  'm0.documents.doc_type.update': {
    call: () => m0DocumentsApi.updateM0DocumentDocType(1, 'test_method'),
    expectedUrl: '/api/m0/documents/1/doc_type',
    assertRequest: expectJsonBody({ doc_type: 'test_method' }),
  },
  'm0.documents.file': {
    call: () => m0DocumentsApi.getM0DocumentFile(1),
    expectedUrl: '/api/m0/documents/1/file',
  },
  'm0.wiki.search': {
    call: () => m0WikiApi.searchM0Wiki('SO 001', 12),
    expectedUrl: '/api/m0/search',
    assertRequest: expectJsonBody({ query: 'SO 001', limit: 12 }),
  },
  'm0.wiki.product.get': {
    call: () => m0WikiApi.getM0WikiProduct('P/001', '2026-08-19T00:00:00Z'),
    expectedUrl: '/api/m0/wiki/products/P%2F001?as_of=2026-08-19T00%3A00%3A00Z',
  },
  'm0.wiki.bom.lines': {
    call: () => m0WikiApi.getM0WikiBomLines('P/001', 'BOM-001', 'R 02'),
    expectedUrl: '/api/m0/wiki/products/P%2F001/bom?bom=BOM-001&revision=R+02',
  },
  'm0.wiki.bom.diff': {
    call: () => m0WikiApi.getM0WikiBomDiff('P/001', 'BOM-001', 'R01', 'R02'),
    expectedUrl: '/api/m0/wiki/products/P%2F001/bom/diff?bom=BOM-001&base=R01&target=R02',
  },
  'm0.wiki.material.get': {
    call: () => m0WikiApi.getM0WikiMaterial('MAT/001'),
    expectedUrl: '/api/m0/wiki/materials/MAT%2F001',
  },
  'm0.wiki.equipment.get': {
    call: () => m0WikiApi.getM0WikiEquipment('EQ/001'),
    expectedUrl: '/api/m0/wiki/equipment/EQ%2F001',
  },
  'm0.wiki.entity.get': {
    call: () => m0WikiApi.getM0WikiEntity('order', 'SO/001', 'V 1'),
    expectedUrl: '/api/m0/wiki/entities/order/SO%2F001?version=V+1',
  },
  'm0.wiki.entity.create': {
    call: () => m0WikiApi.createM0WikiEntity(
      { entityType: 'product', businessKey: 'P-001', payload: { name: '产品 1', status: 'active' }, reason: '新增产品' },
      { trackingTaskId: 'task_wiki_create', mutationId: 'mutation-create-1' },
    ),
    expectedUrl: '/api/m0/wiki/entities',
    assertRequest: (init) => {
      expect(new Headers(init.headers).get('X-Yunpai-Task-ID')).toBe('task_wiki_create');
      expectJsonBody({
        mutation_id: 'mutation-create-1', entity_type: 'product', business_key: 'P-001', version_id: '',
        payload: { name: '产品 1', status: 'active' }, relations: [], expected_version_row_id: '', reason: '新增产品',
      })(init);
    },
  },
  'm0.wiki.entity.update': {
    call: () => m0WikiApi.updateM0WikiEntity(
      {
        entityType: 'order', businessKey: 'SO-001', payload: { customer: '客户 A', status: 'active' },
        expectedVersionRowId: 'row-1', reason: '更新客户',
      },
      { trackingTaskId: 'task_wiki_update', mutationId: 'mutation-update-1' },
    ),
    expectedUrl: '/api/m0/wiki/entities/order/SO-001',
    assertRequest: (init) => {
      expect(new Headers(init.headers).get('X-Yunpai-Task-ID')).toBe('task_wiki_update');
      expectJsonBody({
        mutation_id: 'mutation-update-1', entity_type: 'order', business_key: 'SO-001', version_id: '',
        payload: { customer: '客户 A', status: 'active' }, relations: [], expected_version_row_id: 'row-1', reason: '更新客户',
      })(init);
    },
  },
  'm0.wiki.entity.delete': {
    call: () => m0WikiApi.deleteM0WikiEntity(
      {
        entityType: 'order', businessKey: 'SO-001', versionId: '', expectedVersionRowId: 'row-2', reason: '停用重复订单',
      },
      { trackingTaskId: 'task_wiki_delete', mutationId: 'mutation-delete-1' },
    ),
    expectedUrl: '/api/m0/wiki/entities/order/SO-001',
    assertRequest: (init) => {
      expect(new Headers(init.headers).get('X-Yunpai-Task-ID')).toBe('task_wiki_delete');
      expectJsonBody({
        mutation_id: 'mutation-delete-1', version_id: '', expected_version_row_id: 'row-2', reason: '停用重复订单',
      })(init);
    },
  },
  'm1.ingest.single': {
    call: () => m1Api.createSingleRecognition(file, metadata),
    expectedUrl: '/api/m0/parser-compat/ingest',
    assertRequest: expectFormData,
  },
  'm1.ingest.sync': {
    call: () => m1Api.createSyncRecognition(file, metadata),
    expectedUrl: '/api/m0/parser-compat/ingest/sync',
    assertRequest: expectFormData,
  },
  'm1.ingest.batch': {
    call: () => m1Api.createBatchRecognition([file], metadata),
    expectedUrl: '/api/m0/parser-compat/ingest/batch',
    assertRequest: expectFormData,
  },
  'm1.ingest.archive': {
    call: () => m1Api.createArchiveRecognition(archive, { ...metadata, source: 'archive' }),
    expectedUrl: '/api/m0/parser-compat/ingest/archive',
    assertRequest: expectFormData,
  },
  'm1.batch.get': { call: () => m1Api.getM1Batch('parent-1'), expectedUrl: '/api/m0/parser-compat/batch/parent-1' },
  'm1.tasks.list-filtered': { call: () => m1Api.listM1Tasks('need_review'), expectedUrl: '/api/m0/parser-compat/tasks?status=need_review' },
  'm1.tasks.list': { call: () => m1Api.getM1Tasks(), expectedUrl: '/api/m0/parser-compat/tasks' },
  'm1.tasks.detail': { call: () => m1Api.getM1Task('M1-TASK-001'), expectedUrl: '/api/m0/parser-compat/tasks/M1-TASK-001' },
  'm1.files.preview': { call: () => m1Api.previewM1File('M1-TASK-001'), expectedUrl: '/api/m0/parser-compat/files/M1-TASK-001' },
  'm1.review.queue': { call: () => m1Api.getM1ReviewItems(), expectedUrl: '/api/m0/parser-compat/review/queue' },
  'm1.review.submit': {
    call: () => m1Api.confirmReviewItem(m1ReviewItem, { correctedValue: '2026-07-11', reason: '人工确认' }),
    expectedUrl: '/api/m0/parser-compat/review/M1-TASK-001?approve=true&reviewer=frontend-reviewer&comment=%E4%BA%BA%E5%B7%A5%E7%A1%AE%E8%AE%A4',
    assertRequest: expectJsonBody({ 交付日期: '2026-07-11' }),
  },
  'm1.report.generate': {
    call: () => m1Api.generateM1Report('M1-TASK-001'),
    expectedUrl: '/api/m0/parser-compat/tasks/M1-TASK-001/report',
    assertRequest: noBody,
  },
  'm1.report.download': { call: () => m1Api.downloadM1Report('M1-TASK-001'), expectedUrl: '/api/m0/parser-compat/tasks/M1-TASK-001/report/download' },
  'm1.tasks.delete': { call: () => m1Api.deleteM1Task('M1-TASK-001'), expectedUrl: '/api/m0/parser-compat/tasks/M1-TASK-001' },
  'm2.health': { call: () => m2Api.getM2Health(), expectedUrl: '/api/m2/health' },
  'm2.workflow.run': {
    call: () => m2Api.runM2Workflow({ order_id: 'ORD-001' }),
    expectedUrl: '/api/m2/run',
    assertRequest: expectJsonBody({ order_id: 'ORD-001' }),
  },
  'm2.artifact.download': { call: () => m2Api.downloadM2Artifact('bom/结果.xlsx'), expectedUrl: '/api/m2/artifact?path=bom%2F%E7%BB%93%E6%9E%9C.xlsx' },
  'm2.artifact.read-json': {
    call: () => m2Api.readM2ArtifactJson('sop/parsed_sop.json'),
    expectedUrl: '/api/m2/artifact?path=sop%2Fparsed_sop.json',
  },
  'm2.bom.history.search': {
    call: () => m2Api.searchM2BomHistory({ keyword: '铝板' }),
    expectedUrl: '/api/m2/bom/history/search',
    assertRequest: expectJsonBody({ keyword: '铝板' }),
  },
  'm2.bom.controlled.generate': {
    call: () => m2Api.generateM2ControlledBom({ bom_id: 'BOM-001' }),
    expectedUrl: '/api/m2/bom/generate-controlled',
    assertRequest: expectJsonBody({ bom_id: 'BOM-001' }),
  },
  'm2.bom.template.onboard': {
    call: () => m2Api.onboardM2BomTemplate({ template_id: 'TPL-001' }),
    expectedUrl: '/api/m2/bom/templates/onboard',
    assertRequest: expectJsonBody({ template_id: 'TPL-001' }),
  },
  'm2.sop.generate': {
    call: () => m2Api.generateM2Sop({ order_id: 'ORD-001' }),
    expectedUrl: '/api/m2/sop/generate',
    assertRequest: expectJsonBody({ order_id: 'ORD-001' }),
  },
  'm3.orders.list': { call: () => m3Api.listM3Orders({ keyword: 'A 1' }), expectedUrl: '/api/m3/orders?keyword=A+1' },
  'm3.orders.detail': { call: () => m3Api.getM3Order('ORD-001'), expectedUrl: '/api/m3/orders/ORD-001' },
  'm3.procurement-requirements.run-json': {
    call: () => m3Api.runM3ProcurementRequirements(
      { order_id: 'ORD-001' },
      { trackingTaskId: 'task_contract_m3_run_001' },
    ),
    expectedUrl: '/api/m3/procurement-requirements:run-json',
    assertRequest: (init) => {
      expectJsonBody({ order_id: 'ORD-001' })(init);
      expect(new Headers(init.headers).get('X-Yunpai-Task-ID')).toBe('task_contract_m3_run_001');
    },
  },
  'm3.procurement-requirements.run-json-envelope': {
    call: () => m3Api.runM3ProcurementRequirementsEnvelope(
      { order_id: 'ORD-001' },
      { trackingTaskId: 'task_contract_m3_envelope_001' },
    ),
    expectedUrl: '/api/m3/procurement-requirements:run-json',
    assertRequest: (init) => {
      expectJsonBody({ order_id: 'ORD-001' })(init);
      expect(new Headers(init.headers).get('X-Yunpai-Task-ID')).toBe('task_contract_m3_envelope_001');
    },
  },
  'm3.procurement-plan.run-json': {
    call: () => m3Api.runM3ProcurementPlanJson({ order_id: 'ORD-001' }),
    expectedUrl: '/api/m3/procurement-plan:run-json',
    assertRequest: expectJsonBody({ order_id: 'ORD-001' }),
  },
  'm3.procurement-plan.run': {
    call: () => m3Api.runM3ProcurementPlan('ORD-001'),
    expectedUrl: '/api/m3/procurement-plan:run',
    assertRequest: expectJsonBody({ order_id: 'ORD-001' }),
  },
  'm3.procurement-plan.list': {
    call: () => m3Api.listM3ProcurementPlans('ORD-001', { status: 'draft' }),
    expectedUrl: '/api/m3/procurement-plan?order_id=ORD-001&status=draft',
  },
  'm3.procurement-plan.detail': { call: () => m3Api.getM3ProcurementPlan('PLAN-001'), expectedUrl: '/api/m3/procurement-plan/PLAN-001' },
  'm3.approval-tasks.list': { call: () => m3Api.listM3ApprovalTasks({ status: 'pending' }), expectedUrl: '/api/m3/approval-tasks?status=pending' },
  'm3.approval-tasks.approve': {
    call: () => m3Api.approveM3ApprovalTask('APP-001', { comment: 'ok' }),
    expectedUrl: '/api/m3/approval-tasks/APP-001:approve',
    assertRequest: expectJsonBody({ comment: 'ok' }),
  },
  'm3.approval-tasks.reject': {
    call: () => m3Api.rejectM3ApprovalTask('APP-001', { reason: 'risk' }),
    expectedUrl: '/api/m3/approval-tasks/APP-001:reject',
    assertRequest: expectJsonBody({ reason: 'risk' }),
  },
  'm3.approval-tasks.request-change': {
    call: () => m3Api.requestChangeM3ApprovalTask('APP-001', { reason: 'change' }),
    expectedUrl: '/api/m3/approval-tasks/APP-001:request-change',
    assertRequest: expectJsonBody({ reason: 'change' }),
  },
  'm3.approval-tasks.approve-to-send': {
    call: () => m3Api.approveM3ApprovalTaskToSend('APP-001', { comment: 'send' }),
    expectedUrl: '/api/m3/approval-tasks/APP-001:approve_to_send',
    assertRequest: expectJsonBody({ comment: 'send' }),
  },
  'm3.material-readiness': { call: () => m3Api.getM3MaterialReadiness('ORD-001'), expectedUrl: '/api/m3/material-readiness?order_id=ORD-001' },
  'm3.persisted-procurement-plans.list': {
    call: () => m3Api.listPersistedM3Plans({ tenantId: '11111111-1111-4111-8111-111111111111', pageSize: 50 }),
    expectedUrl: '/api/m3/persisted/procurement-plans?tenant_id=11111111-1111-4111-8111-111111111111&page=1&page_size=50',
  },
  'm3.pr-po-drafts': { call: () => m3Api.getM3PrPoDrafts('ORD-001'), expectedUrl: '/api/m3/pr-po-drafts?order_id=ORD-001' },
  'm3.procurement-plan.handoff-to-m4': {
    call: () => m3Api.handoffM3PlanToM4('PLAN-001', { dry_run: true }),
    expectedUrl: '/api/m3/procurement-plan/PLAN-001/handoff-to-m4',
    assertRequest: expectJsonBody({ dry_run: true }),
  },
  'm3.procurement-plan.export-suggestions': {
    call: () => m3Api.exportM3ProcurementSuggestions('PLAN-001'),
    expectedUrl: '/api/m3/procurement-plan/PLAN-001/export-suggestions',
  },
  'm4.suppliers.list': { call: () => m4Api.listM4Suppliers({ page: 1, pageSize: 20 }), expectedUrl: '/api/m4/suppliers?page=1&page_size=20' },
  'm4.suppliers.create': {
    call: () => m4Api.createM4Supplier({ supplier_name: '华东供应商', default_channel: 'email', status: 'active' }),
    expectedUrl: '/api/m4/suppliers',
  },
  'm4.suppliers.update': { call: () => m4Api.updateM4Supplier(1, { remark: 'checked' }), expectedUrl: '/api/m4/suppliers/1' },
  'm4.import-batches.upload': {
    call: () => m4Api.uploadM4ImportBatch(new File(['item_code'], 'purchase.csv', { type: 'text/csv' })),
    expectedUrl: '/api/m4/import-batches',
    assertRequest: expectFormData,
  },
  'm4.import-batches.detail': { call: () => m4Api.getM4ImportBatch(1), expectedUrl: '/api/m4/import-batches/1' },
  'm4.suggestions.import-json': {
    call: () => m4Api.importM4SuggestionsJson({ items: [m4Suggestion] }),
    expectedUrl: '/api/m4/suggestions/import-json',
    assertRequest: expectJsonBody({ suggestions: [m4Suggestion] }),
  },
  'm4.suggestions.list': { call: () => m4Api.listM4Suggestions({ page: 1, pageSize: 20, validationStatus: 'valid' }), expectedUrl: '/api/m4/suggestions?page=1&page_size=20&validation_status=valid' },
  'm4.purchase-orders.generate': { call: () => m4Api.generateM4PurchaseOrders([101]), expectedUrl: '/api/m4/purchase-orders/generate' },
  'm4.purchase-orders.list': { call: () => m4Api.listM4PurchaseOrders({ page: 1, pageSize: 20, status: 'pending_review' }), expectedUrl: '/api/m4/purchase-orders?page=1&page_size=20&status=pending_review' },
  'm4.purchase-orders.detail': { call: () => m4Api.getM4PurchaseOrder(201), expectedUrl: '/api/m4/purchase-orders/201' },
  'm4.purchase-orders.update': { call: () => m4Api.updateM4PurchaseOrder(201, { required_date: '2026-08-01', items: [] }), expectedUrl: '/api/m4/purchase-orders/201' },
  'm4.purchase-orders.submit-review': { call: () => m4Api.submitM4PurchaseOrderReview(201, { comment: 'submit' }), expectedUrl: '/api/m4/purchase-orders/201/submit-review' },
  'm4.purchase-orders.approve': { call: () => m4Api.approveM4PurchaseOrder(201, { operated_by: 'tester' }), expectedUrl: '/api/m4/purchase-orders/201/approve' },
  'm4.purchase-orders.reject': { call: () => m4Api.rejectM4PurchaseOrder(201, { comment: 'reject' }), expectedUrl: '/api/m4/purchase-orders/201/reject' },
  'm4.purchase-orders.inquiry-message': { call: () => m4Api.generateM4PurchaseInquiryMessage(201, { channel: 'email' }), expectedUrl: '/api/m4/purchase-orders/201/inquiry-message' },
  'm4.purchase-orders.send': { call: () => m4Api.sendM4PurchaseOrder(201), expectedUrl: '/api/m4/purchase-orders/201/send', assertRequest: expectJsonBody({ record_only: true }) },
  'm4.purchase-orders.simulate-confirm': { call: () => m4Api.simulateM4SupplierConfirmation(201, { promised_date: '2026-08-20', note: 'demo' }), expectedUrl: '/api/m4/purchase-orders/201/simulate-confirm', assertRequest: expectJsonBody({ promised_date: '2026-08-20', note: 'demo' }) },
  'm4.replies.create': { call: () => m4Api.createM4SupplierReply(m4Reply), expectedUrl: '/api/m4/replies' },
  'm4.replies.parse': { call: () => m4Api.parseM4SupplierReply(501), expectedUrl: '/api/m4/replies/501/parse', assertRequest: noBody },
  'm4.replies.confirm': { call: () => m4Api.confirmM4ReplyParse(501, { ...m4ParseResult, confirmed_by: 'tester' }), expectedUrl: '/api/m4/replies/501/confirm' },
  'm4.tracking.list': { call: () => m4Api.listM4Tracking({ page: 1, pageSize: 20 }), expectedUrl: '/api/m4/tracking?page=1&page_size=20' },
  'm4.tracking.export-csv': { call: () => m4Api.exportM4TrackingCsv(), expectedUrl: '/api/m4/tracking/export.csv' },
  'm4.alerts.scan': { call: () => m4Api.scanM4Alerts(), expectedUrl: '/api/m4/alerts/scan', assertRequest: noBody },
  'm4.alerts.list': { call: () => m4Api.listM4Alerts({ page: 1, pageSize: 20, status: 'open', alertType: 'overdue' }), expectedUrl: '/api/m4/alerts?page=1&page_size=20&status=open&alert_type=overdue' },
  'm4.alerts.urge-message': { call: () => m4Api.generateM4AlertUrgeMessage(701, { channel: 'wechat' }), expectedUrl: '/api/m4/alerts/701/urge-message' },
  'm4.alerts.export-csv': { call: () => m4Api.exportM4AlertsCsv(), expectedUrl: '/api/m4/alerts/export.csv' },
  'm4.alerts.status.update': { call: () => m4Api.updateM4AlertStatus(701, 'processing'), expectedUrl: '/api/m4/alerts/701/status', assertRequest: expectJsonBody({ status: 'processing' }) },
  'm5.schedules.create': { call: () => m5Api.createM5Schedule({ scenario_id: 'SCN-001' }), expectedUrl: '/api/m5/schedules' },
  'm5.schedules.list': { call: () => m5Api.listM5Schedules({ limit: 2 }), expectedUrl: '/api/m5/schedules?limit=2' },
  'm5.schedules.get': { call: () => m5Api.getM5Schedule('PV-001'), expectedUrl: '/api/m5/schedules/PV-001' },
  'm5.schedules.intelligent': { call: () => m5Api.createM5IntelligentSchedule({ scenario_id: 'SCN-001' }), expectedUrl: '/api/m5/schedules/intelligent' },
  'm5.operations.update': { call: () => m5Api.updateM5Operation('PV-001', 'ORD-001', 'OP-001', { start_day: 3 }), expectedUrl: '/api/m5/schedules/PV-001/operations/ORD-001/OP-001' },
  'm5.operations.lock': { call: () => m5Api.lockM5Operation('PV-001', 'ORD-001', 'OP-001'), expectedUrl: '/api/m5/schedules/PV-001/operations/ORD-001/OP-001/lock', assertRequest: expectJsonBody({ reason: '前端锁定' }) },
  'm5.operations.unlock': { call: () => m5Api.unlockM5Operation('PV-001', 'ORD-001', 'OP-001'), expectedUrl: '/api/m5/schedules/PV-001/operations/ORD-001/OP-001/unlock', assertRequest: expectJsonBody({ reason: '前端解锁' }) },
  'm5.schedules.dispatch': { call: () => m5Api.dispatchM5Schedule('PV-001', { dispatch: true }), expectedUrl: '/api/m5/schedules/PV-001/dispatch' },
  'm5.schedules.feedback': {
    call: () => m5Api.submitScheduleFeedback('PV-001', 'approve', '审批通过', 'task_real_123'),
    expectedUrl: '/api/m5/schedules/PV-001/feedback',
    assertRequest: (init) => {
      expectJsonBody({ action: 'approve', reason: '审批通过' })(init);
      expect(new Headers(init.headers).get('X-Yunpai-Task-ID')).toBe('task_real_123');
    },
  },
  'm5.execution-events.create': { call: () => m5Api.createM5ExecutionEvent('PV-001', { event: 'start' }), expectedUrl: '/api/m5/schedules/PV-001/execution-events' },
  'm5.execution-summary.get': { call: () => m5Api.getM5ExecutionSummary('PV-001'), expectedUrl: '/api/m5/schedules/PV-001/execution-summary' },
  'm5.pmc.progress': { call: () => m5Api.getM5PmcProgress('PV-001'), expectedUrl: '/api/m5/pmc/progress?plan_version=PV-001' },
  'm5.leader.teams.list': {
    call: () => leaderApi.listLeaderTeams('leader-zhang'),
    expectedUrl: '/api/m5/leader/teams?leader_user_id=leader-zhang',
  },
  'm5.leader.teams.create': {
    call: () =>
      leaderApi.createLeaderTeam({
        team_code: 'TEAM-A1',
        team_name: '一车间 A 班',
        leader_user_id: 'leader-zhang',
        resource_ids: ['EQ-CUT'],
        shift_rule: { shift: 'day' },
      }),
    expectedUrl: '/api/m5/leader/teams',
    assertRequest: (init) => {
      const body = JSON.parse(String(init.body ?? '{}')) as { team_code?: string };
      expect(body.team_code).toBe('TEAM-A1');
    },
  },
  'm5.leader.teams.get': {
    call: () => leaderApi.getLeaderTeam('TEAM-A1'),
    expectedUrl: '/api/m5/leader/teams/TEAM-A1',
  },
  'm5.leader.members.list': {
    call: () => leaderApi.listLeaderTeamMembers('TEAM-A1'),
    expectedUrl: '/api/m5/leader/teams/TEAM-A1/members',
  },
  'm5.leader.members.create': {
    call: () => leaderApi.addLeaderTeamMember('TEAM-A1', { worker_id: 'worker-li', worker_name: '李师傅' }),
    expectedUrl: '/api/m5/leader/teams/TEAM-A1/members',
  },
  'm5.leader.today-tasks.get': {
    call: () => leaderApi.getLeaderTodayTasks('leader-zhang', '2026-08-10'),
    expectedUrl: '/api/m5/leader/today-tasks?leader_user_id=leader-zhang&day=2026-08-10',
  },
  'm5.leader.report.create': {
    call: () =>
      leaderApi.reportLeaderWork({
        plan_version: 'PV-001',
        order_id: 'SO-LEADER-001',
        operation_id: 'OP-10',
        resource_id: 'EQ-CUT',
        team_id: 'TEAM-A1',
        leader_user_id: 'leader-zhang',
        worker_id: 'worker-wang',
        event_type: 'actual_start',
        actual_start_time: '2026-08-10T00:05:00Z',
        occurred_at: '2026-08-10T00:05:00Z',
        shift_date: '2026-08-10',
      }),
    expectedUrl: '/api/m5/leader/report',
  },
  'm5.leader.workload.query': {
    call: () => leaderApi.queryWorkload({ team_id: 'TEAM-A1', shift_date: '2026-08-10' }),
    expectedUrl: '/api/m5/leader/workload?team_id=TEAM-A1&shift_date=2026-08-10',
  },
  'm5.leader.workload.comparison': {
    call: () =>
      leaderApi.getWorkloadComparison({
        team_id: 'TEAM-A1',
        date_from: '2026-08-01',
        date_to: '2026-08-10',
      }),
    expectedUrl: '/api/m5/leader/workload/comparison?team_id=TEAM-A1&date_from=2026-08-01&date_to=2026-08-10',
  },
  'm5.leader.orders.workload': {
    call: () => leaderApi.getOrderWorkload('SO-LEADER-001'),
    expectedUrl: '/api/m5/leader/orders/workload?order_id=SO-LEADER-001',
  },
  'm5.piece-wage.daily': {
    call: () => pieceWageApi.fetchPieceWageDaily({ shift_date: '2026-08-20' }),
    expectedUrl: '/api/m5/piece-wage/daily?shift_date=2026-08-20',
  },
  'm5.piece-wage.rates': {
    call: () => pieceWageApi.fetchPieceRates({ order_id: 'SO-1' }),
    expectedUrl: '/api/m5/piece-wage/rates?order_id=SO-1',
  },
  'm5.leader.bindings.list': {
    call: () => leaderApi.listOrderBindings({ order_id: 'SO-LEADER-001' }),
    expectedUrl: '/api/m5/leader/bindings?order_id=SO-LEADER-001',
  },
  'm5.leader.bindings.create': {
    call: () =>
      leaderApi.bindWorkersToOrder({
        order_id: 'SO-LEADER-001',
        worker_ids: ['worker-wang'],
        team_id: 'TEAM-A1',
      }),
    expectedUrl: '/api/m5/leader/bindings',
  },
  'm5.leader.bindings.delete': {
    call: () => leaderApi.unbindWorkerFromOrder('binding-1'),
    expectedUrl: '/api/m5/leader/bindings/binding-1',
  },
  'm5.worker.tasks.list': {
    call: () => leaderApi.listWorkerTasks('worker-wang'),
    expectedUrl: '/api/m5/worker/tasks?worker_id=worker-wang',
  },
  'm5.worker.report.create': {
    call: () =>
      leaderApi.reportWorkerWork({
        worker_id: 'worker-wang',
        plan_version: 'PV-001',
        order_id: 'SO-LEADER-001',
        operation_id: 'OP-10',
        resource_id: 'EQ-CUT',
        event_type: 'quantity_report',
        reported_quantity: 300,
        reported_unit: 'pcs',
        actual_min: 360,
        idempotency_key: 'worker-report-001',
      }, 'task-plan-001'),
    expectedUrl: '/api/m5/worker/report',
    assertRequest: (init) => {
      expectJsonBody({
        worker_id: 'worker-wang',
        plan_version: 'PV-001',
        order_id: 'SO-LEADER-001',
        operation_id: 'OP-10',
        resource_id: 'EQ-CUT',
        event_type: 'quantity_report',
        reported_quantity: 300,
        reported_unit: 'pcs',
        actual_min: 360,
        idempotency_key: 'worker-report-001',
      })(init);
      expect(new Headers(init.headers).get('X-Yunpai-Task-ID')).toBe('task-plan-001');
    },
  },
  'm5.worker.order-operations.list': {
    call: () => leaderApi.listWorkerOrderOperations('SO-LEADER-001'),
    expectedUrl: '/api/m5/worker/order-operations?order_id=SO-LEADER-001',
  },
  'qc.dashboard': {
    call: () => qcApi.getQcDashboard(),
    expectedUrl: '/api/qc/dashboard',
  },
  'qc.telemetry.query': {
    call: () => qcApi.queryQcTelemetry({ limit: 20, order_id: 'SO-001' }),
    expectedUrl: '/api/qc/telemetry?limit=20&order_id=SO-001',
  },
  'm7.delivery-notes.list': { call: () => m7Api.listM7DeliveryNotes(), expectedUrl: '/api/m7/delivery-notes' },
  'm7.delivery-notes.create': {
    call: () => m7Api.createM7DeliveryNote({ delivery_note_number: 'DN-1', supplier_id: 'SUP-1', supplier_delivery_number: 'SDN-1', purchase_order_id: '1', order_id: 'SO-1', dedicated_order_id: 'SO-DEDICATED', warehouse_id: 'WH-01', idempotency_key: 'delivery:DN-1', items: [{ purchase_order_item_id: '11', material_id: 'MAT-1', material_code: 'MAT-1', batch_no: 'LOT-1', quantity: '10', uom: 'pcs' }] }, 'task_m7_contract'),
    expectedUrl: '/api/m7/delivery-notes',
    assertRequest: expectJsonBody(expect.objectContaining({ dedicated_order_id: 'SO-DEDICATED' })),
  },
  'm7.delivery-notes.scan': { call: () => m7Api.scanM7DeliveryNote('batch-1', 'task_m7_contract'), expectedUrl: '/api/m7/delivery-notes/scan' },
  'm7.delivery-notes.sign': {
    call: () => m7Api.signM7DeliveryNote({ delivery_note_id: 'dn-1', delivery_note_number: 'DN-1', supplier_id: 'SUP-1', purchase_order_id: '1', order_id: 'SO-1', warehouse_id: 'WH-01', status: 'draft', tracking_task_id: 'task_m7_contract', items: [] }, 'signed'),
    expectedUrl: '/api/m7/delivery-notes/dn-1/sign',
  },
  'm7.inspections.pending': { call: () => m7Api.listM7PendingInspections(), expectedUrl: '/api/m7/qc-pending' },
  'm7.inspections.sample': {
    call: () => m7Api.sampleM7Inspection({ inspection_lot_id: 'insp-1', delivery_note_id: 'dn-1', material_code: 'MAT-1', batch_no: 'LOT-1', lot_quantity: '10', recommended_sample_quantity: '1', sampling_rule: 'default_rate:0.1', status: 'pending', tracking_task_id: 'task_m7_contract' }, 1, 0, 'sample'),
    expectedUrl: '/api/m7/inspection-lots/insp-1/sample',
  },
  'm7.inspections.confirm': {
    call: () => m7Api.confirmM7Inspection({ inspection_lot_id: 'insp-1', delivery_note_id: 'dn-1', material_code: 'MAT-1', batch_no: 'LOT-1', lot_quantity: '10', recommended_sample_quantity: '1', sampling_rule: 'default_rate:0.1', status: 'sampling', tracking_task_id: 'task_m7_contract' }, 'passed', 'ok'),
    expectedUrl: '/api/m7/inspection-lots/insp-1/confirm',
  },
  'm7.inventory.query': { call: () => m7Api.queryM7Inventory(), expectedUrl: '/api/m7/inventory' },
  'm7.inventory.allocate': {
    call: () => m7Api.allocateM7InventoryToOrder({ warehouse_id: 'WH-01', material_id: 'MAT-1', material_code: 'MAT-1', batch_no: 'LOT-1', quantity: 4, uom: 'pcs', order_id: 'SO-1', idempotency_key: 'allocation:SO-1:MAT-1:LOT-1' }),
    expectedUrl: '/api/m7/inventory/allocations',
  },
  'm7.inventory.allocation-release': {
    call: () => m7Api.releaseM7InventoryAllocation({ allocation_id: 'allocation-1', inventory_balance_id: 'balance-1', warehouse_id: 'WH-01', material_id: 'MAT-1', material_code: 'MAT-1', batch_no: 'LOT-1', uom: 'pcs', order_id: 'SO-1', quantity_allocated: '4', quantity_consumed: '0', quantity_remaining: '4', status: 'active', tracking_task_id: 'task_m7_contract' }),
    expectedUrl: '/api/m7/inventory/allocations/allocation-1/release',
  },
  'm7.material-issues.create': {
    call: () => m7Api.createM7MaterialIssue({ issue_number: 'MI-1', order_id: 'SO-1', purpose: 'production', idempotency_key: 'issue:MI-1', items: [{ warehouse_id: 'WH-01', material_id: 'MAT-1', material_code: 'MAT-1', batch_no: 'LOT-1', requested_quantity: 1, uom: 'pcs' }] }, 'task_m7_contract'),
    expectedUrl: '/api/m7/material-issues',
  },
  'm7.material-issues.over': {
    call: () => m7Api.createM7OverIssue({ issue_number: 'MI-2', order_id: 'SO-1', purpose: 'production', idempotency_key: 'issue:MI-2', reason_code: 'SCRAP', reason: 'setup scrap', items: [{ warehouse_id: 'WH-01', material_id: 'MAT-1', material_code: 'MAT-1', batch_no: 'LOT-1', requested_quantity: 2, uom: 'pcs' }] }, 'task_m7_contract'),
    expectedUrl: '/api/m7/material-issues/over',
  },
  'm7.material-issues.list': { call: () => m7Api.listM7MaterialIssues(), expectedUrl: '/api/m7/material-issues' },
  'm7.material-issues.approve': {
    call: () => m7Api.approveM7OverIssue({ material_issue_id: 'issue-1', issue_number: 'MI-1', order_id: 'SO-1', issue_type: 'over', status: 'pending_approval', tracking_task_id: 'task_m7_contract', requested_by: 'requester', items: [] }, 'approved'),
    expectedUrl: '/api/m7/material-issues/issue-1/approve',
  },
  'm5.schedule-jobs.create': { call: () => m5Api.createM5ScheduleJob({ scenario_id: 'SCN-001' }), expectedUrl: '/api/m5/schedules/jobs' },
  'm5.ops-jobs.get': { call: () => m5Api.getM5Job('m5-job-001'), expectedUrl: '/api/m5/ops/jobs/m5-job-001' },
  'm5.ops.flow-dashboard': {
    call: () => m5Api.getM5FlowDashboard({ trackingTaskId: 'task-contract-1', planVersion: 'PV-001', limit: 5 }),
    expectedUrl: '/api/m5/ops/flow-dashboard?tracking_task_id=task-contract-1&plan_version=PV-001&limit=5',
  },
  'm5.snapshots.readiness': { call: () => m5Api.getM5SnapshotReadiness('SCN-001'), expectedUrl: '/api/m5/integrations/snapshots/SCN-001/readiness' },
  'm5.materials.procurement-plan': { call: () => m5Api.createM5MaterialProcurementPlan({ material_id: 'MAT-001' }), expectedUrl: '/api/m5/materials/procurement-plan' },
  'm5.facade.schedule-board': {
    call: () => scheduleApi.getScheduleBoard(),
    expectedUrl: ['/api/m5/schedules', '/api/m5/schedules/PV-001'],
  },
  'm5.facade.schedule-dependencies': {
    call: () => scheduleApi.getScheduleDependencies(),
    expectedUrl: ['/api/m5/schedules', '/api/m5/schedules/PV-001/dependencies'],
  },
  'm5.facade.schedule-events': {
    call: () => scheduleApi.getScheduleEvents('PV-001'),
    expectedUrl: '/api/m5/schedules/PV-001/events?limit=50',
  },
  'm5.facade.replan-from-version': {
    call: () => scheduleApi.replanFromVersion('PV-001', {
      idempotency_key: 'replan-1',
      event: {
        event_id: 'EV-REPLAN-1',
        sequence: 1,
        occurred_at: '2026-08-18T00:00:00Z',
        event_type: 'capacity_change',
        source: 'contract-test',
        severity: 'medium',
        reason: 'contract matrix coverage',
      },
    }),
    expectedUrl: '/api/m5/schedules/PV-001/replan-from-version',
  },
  'm5.facade.adjust-task': {
    call: () =>
      scheduleApi.adjustScheduleTask({
        taskId: 'SCH-1',
        planVersion: 'PV-001',
        orderId: 'ORD-001',
        operationId: 'OP-001',
        startAt: '2026-07-10T08:00:00Z',
        endAt: '2026-07-10T12:00:00Z',
        reason: 'contract',
      }),
    expectedUrl: '/api/m5/schedules/PV-001/operations/ORD-001/OP-001',
    assertRequest: expectJsonBody({
      reason: 'contract',
      start_time: '2026-07-10T08:00:00Z',
      end_time: '2026-07-10T12:00:00Z',
      lock_after_adjust: false,
    }),
  },
  'm6.health': { call: () => m6Api.getM6Health(), expectedUrl: '/api/m6/health' },
  'm6.finance.cost': { call: () => m6Api.calculateM6FinanceCost({ bom_id: 'BOM-001' }), expectedUrl: '/api/m6/finance/cost' },
  'm6.finance.bom.import': { call: () => m6Api.importM6FinanceBom({ bom_path: 'bom.xlsx' }), expectedUrl: '/api/m6/finance/bom/import' },
  'm8.health': { call: () => m8Api.getM8Health(), expectedUrl: '/api/m8/health' },
  'm8.projects.create': { call: () => m8Api.createM8Project({ name: 'design' }), expectedUrl: '/api/m8/projects' },
  'm8.projects.get': { call: () => m8Api.getM8Project('M8-PROJ-001'), expectedUrl: '/api/m8/projects/M8-PROJ-001' },
  'm8.messages.send': { call: () => m8Api.sendM8ProjectMessage('M8-PROJ-001', { message: 'start' }), expectedUrl: '/api/m8/projects/M8-PROJ-001/messages' },
  'm8.runs.get': { call: () => m8Api.getM8Run('M8-PROJ-001', 'M8-RUN-001'), expectedUrl: '/api/m8/projects/M8-PROJ-001/runs/M8-RUN-001' },
  'm8.human-decisions.submit': { call: () => m8Api.submitM8HumanDecision('M8-PROJ-001', { accepted: true }), expectedUrl: '/api/m8/projects/M8-PROJ-001/human-decisions' },
  'm8.outputs.json': { call: () => m8Api.getM8OutputJson('M8-PROJ-001', 'summary'), expectedUrl: '/api/m8/projects/M8-PROJ-001/outputs/summary' },
  'm8.outputs.text': { call: () => m8Api.getM8OutputText('M8-PROJ-001', 'summary'), expectedUrl: '/api/m8/projects/M8-PROJ-001/outputs/summary' },
  'm8.assets.blob': { call: () => m8Api.getM8Asset('M8-PROJ-001', 'drawing.dwg'), expectedUrl: '/api/m8/projects/M8-PROJ-001/assets/drawing.dwg' },
  'm8.cad.contract': { call: () => m8Api.getM8CadDrawingAgentContract(), expectedUrl: '/api/m8/cad-drawing-agent/contract' },
  'm8.cad.request': { call: () => m8Api.createM8CadDrawingRequest('M8-PROJ-001', { prompt: 'draw' }), expectedUrl: '/api/m8/projects/M8-PROJ-001/cad-drawing-requests' },
  'demo.bom.items.list': { call: () => bomApi.getBomItems(), expectedUrl: '/api/demo/bom/items' },
  'demo.bom.items.review': { call: () => bomApi.reviewBomItem('BOM-001', 'approved', 'ok'), expectedUrl: '/api/demo/bom/items/BOM-001/review' },
  'demo.sop.steps': { call: () => sopApi.getSopSteps(), expectedUrl: '/api/demo/sop/steps' },
  'demo.purchase.warnings.list': { call: () => purchaseApi.getPurchaseWarnings(), expectedUrl: '/api/demo/purchase/warnings' },
  'demo.purchase.warnings.follow': { call: () => purchaseApi.followPurchaseWarning('PW-001'), expectedUrl: '/api/demo/purchase/warnings/PW-001/follow', assertRequest: noBody },
  'demo.legal.risks.list': {
    call: () => {
      vi.stubEnv('VITE_API_BASE_URL', '');
      vi.stubEnv('VITE_ENABLE_MSW', 'true');
      return legalApi.getLegalRisks();
    },
    expectedUrl: '/api/demo/legal/risks',
  },
  'demo.legal.risks.final-review': {
    call: () => {
      vi.stubEnv('VITE_API_BASE_URL', '');
      vi.stubEnv('VITE_ENABLE_MSW', 'true');
      return legalApi.submitLegalFinalReview('LEGAL-001', 'approved', 'ok');
    },
    expectedUrl: '/api/demo/legal/risks/LEGAL-001/final-review',
  },
  'demo.notifications.list': {
    call: () => {
      vi.stubEnv('VITE_API_BASE_URL', '');
      vi.stubEnv('VITE_ENABLE_MSW', 'true');
      return notificationApi.getNotifications();
    },
    expectedUrl: '/api/notifications',
  },
};

const assertMethod = (item: ApiContractItem, init: RequestInit) => {
  expect(init.method ?? 'GET').toBe(item.method);
};

const assertRequestKind = (item: ApiContractItem, init: RequestInit) => {
  if (item.requestKind === 'formData') {
    expectFormData(init);
    return;
  }
  if (item.requestKind === 'none') {
    expect(init.body).toBeUndefined();
    return;
  }
  expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  expect(typeof init.body).toBe('string');
};

const assertResponseKind = async (item: ApiContractItem, value: unknown) => {
  if (item.responseKind === 'blob') {
    expect(value).toBeInstanceOf(Blob);
    return;
  }
  if (item.responseKind === 'text') {
    expect(typeof value).toBe('string');
  }
};

const exportName = (key: string, value: unknown) =>
  typeof value === 'function' &&
  /^[a-zA-Z_][\w$]*$/.test(key) &&
  !key.endsWith('Schema') &&
  key !== 'default';

describe('apiContractManifest', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('has unique ids and no demo-only items marked as real backend', () => {
    expect(new Set(apiContractManifest.map((item) => item.id)).size).toBe(apiContractManifest.length);
    expect(apiContractManifest.filter((item) => item.realBackendStatus === 'demo_only').every((item) => item.module === 'demo')).toBe(true);
    expect(apiContractManifest.some((item) => item.pathPattern.includes('/api/v1'))).toBe(false);
  });

  it('contains structured consumer, parser, ChatApp reuse, and risk audit fields', () => {
    const forbiddenPlaceholders = [
      'No ChatApp consumer; see service export usage and contract test.',
      'No endpoint-specific gap recorded.',
      'endpoint-specific adapter',
    ];
    const rawUnknownResponseIds = new Set([
      'm1.ingest.sync',
      'm1.review.submit',
      'm2.artifact.read-json',
      'm8.human-decisions.submit',
    ]);

    for (const item of apiContractManifest) {
      expect(item.responseParser.length, `${item.id} responseParser`).toBeGreaterThan(0);
      expect(item.consumers.length, `${item.id} consumers`).toBeGreaterThan(0);
      expect(item.riskGap.length, `${item.id} riskGap`).toBeGreaterThan(0);
      expect(item.responseParser, `${item.id} responseParser`).not.toBe(item.responseKind);
      for (const placeholder of forbiddenPlaceholders) {
        expect(item.consumers.join(' '), `${item.id} consumers`).not.toContain(placeholder);
        expect(item.riskGap, `${item.id} riskGap`).not.toContain(placeholder);
      }
      expect(
        item.consumers.every((consumer) => consumer.startsWith('src/') || consumer.startsWith('contract-only:')),
        `${item.id} consumer audit format`,
      ).toBe(true);
      if (rawUnknownResponseIds.has(item.id)) {
        expect(item.responseParser, `${item.id} raw unknown response`).toBe(
          'raw JSON decode; response remains unvalidated unknown',
        );
      }
    }

    const chat = apiContractManifest.find((item) => item.id === 'orchestrator.chat.stream');
    expect(chat).toMatchObject({
      pathPattern: '/api/orchestrator/chat/stream',
      realBackendStatus: 'real',
      chatAppReuse: 'default',
    });
    expect(chat?.responseParser).toContain('Zod');
    expect(chat?.consumers).toEqual(
      expect.arrayContaining([
        'src/pages/EnterpriseAssistantPage.tsx',
        'src/features/chat/ChatPanel.tsx',
        'src/store/useChatStore.ts',
        'src/services/chatApi.ts',
      ]),
    );
    expect(chat?.riskGap).toContain('ORCH_LLM_API_KEY');
    expect(chat?.riskGap).toContain('ToolRegistry');
    expect(chat?.riskGap).not.toContain('reserved');
  });

  it('has a test case for every manifest item', () => {
    expect(Object.keys(contractCases).sort()).toEqual(apiContractManifest.map((item) => item.id).sort());
  });

  it('points every manifest and ignored export at an existing runtime export', () => {
    for (const item of [...apiContractManifest, ...apiContractIgnoredExports]) {
      expect(serviceModules[item.serviceFile], item.serviceFile).toBeDefined();
      expect(serviceModules[item.serviceFile]?.[item.exportName], `${item.serviceFile}#${item.exportName}`).toBeDefined();
    }
  });

  it('registers or explicitly ignores every runtime service function export', () => {
    const registered = new Set(apiContractManifest.map((item) => `${item.serviceFile}#${item.exportName}`));
    const ignored = new Set(apiContractIgnoredExports.map((item) => `${item.serviceFile}#${item.exportName}`));

    for (const serviceFile of apiContractServiceFiles) {
      const moduleExports = serviceModules[serviceFile];
      expect(moduleExports, serviceFile).toBeDefined();

      for (const [name, value] of Object.entries(moduleExports ?? {})) {
        if (exportName(name, value)) {
          expect(registered.has(`${serviceFile}#${name}`) || ignored.has(`${serviceFile}#${name}`), `${serviceFile}#${name}`).toBe(true);
        }
      }
    }
  });

  it.each(apiContractManifest)('$id emits the expected request contract', async (item) => {
    const contractCase = contractCases[item.id];
    if (!contractCase) {
      throw new Error(`Missing contract case for ${item.id}`);
    }
    let callIndex = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => responseFor(item, callIndex++));

    if (item.id === 'm8.cad.request') {
      await expect(contractCase.call()).rejects.toMatchObject({ error: { status: 501 } });
    } else {
      const value = await contractCase.call();
      await assertResponseKind(item, value);
    }

    const expectedUrls = Array.isArray(contractCase.expectedUrl) ? contractCase.expectedUrl : [contractCase.expectedUrl];
    expect(fetchSpy).toHaveBeenCalledTimes(expectedUrls.length);
    expectedUrls.forEach((expectedUrl, index) => {
      const [url, init = {}] = fetchSpy.mock.calls[index] as [RequestInfo | URL, RequestInit | undefined];
      expect(String(url)).toBe(expectedUrl);
      assertMethod(item, init);
      assertRequestKind(item, init);
      contractCase.assertRequest?.(init);
    });
  });

  it('keeps orchestrator job states explicit and does not assume SSE', async () => {
    server.use(
      http.get('/api/orchestrator/jobs/running-job', () =>
        HttpResponse.json({ job_id: 'running-job', status: 'running', tools: ['m5'], steps: [] }),
      ),
      http.get('/api/orchestrator/jobs/done-job', () =>
        HttpResponse.json({ job_id: 'done-job', status: 'done', tools: ['m5'], steps: [], result: { content: 'done' } }),
      ),
      http.get('/api/orchestrator/jobs/failed-job', () =>
        HttpResponse.json({ job_id: 'failed-job', status: 'failed', tools: ['m5'], steps: [], error: 'failed' }),
      ),
    );

    await expect(orchestratorApi.getJob('running-job')).resolves.toMatchObject({ status: 'running' });
    await expect(orchestratorApi.getJob('done-job')).resolves.toMatchObject({ status: 'done' });
    await expect(orchestratorApi.getJob('failed-job')).resolves.toMatchObject({ status: 'failed', error: 'failed' });
  });

  it('treats demo-only legal services as not implemented in real backend mode', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    vi.stubEnv('VITE_ENABLE_MSW', 'false');

    await expect(legalApi.getLegalRisks()).rejects.toMatchObject({ error: { code: 'not_implemented' } });
    await expect(legalApi.submitLegalFinalReview('LEGAL-001', 'approved', 'ok')).rejects.toMatchObject({
      error: { code: 'not_implemented' },
    });
  });

  it('treats the demo-only notifications service as not implemented in real backend mode', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    vi.stubEnv('VITE_ENABLE_MSW', 'false');

    await expect(notificationApi.getNotifications()).rejects.toMatchObject({ error: { code: 'not_implemented' } });
  });

  it('keeps every legal contract inside the Demo-only not-implemented namespace', () => {
    const legalContracts = apiContractManifest.filter((item) => item.serviceFile === 'src/services/legalApi.ts');

    expect(legalContracts).toHaveLength(2);
    expect(legalContracts.every((item) => item.pathPattern.startsWith('/api/demo/legal/'))).toBe(true);
    expect(legalContracts.every((item) => item.realBackendStatus === 'not_implemented')).toBe(true);
  });

  it('keeps legal independent from M5, scheduling, and orchestrator services', async () => {
    const [legalSource, m5Schema, flowFixture, gateway, compose] = await Promise.all([
      readFile('src/services/legalApi.ts', 'utf8'),
      readFile('src/schemas/m5.ts', 'utf8'),
      readFile('src/mocks/fixtures/agentFlow.json', 'utf8'),
      readFile('api-gateway/nginx.conf', 'utf8'),
      readFile('../deploy/source-runtime/compose.yml', 'utf8'),
    ]);

    expect(legalSource).not.toMatch(/from\s+['"].*(?:m5Api|scheduleApi|orchestratorApi)['"]/);
    expect(legalSource).not.toMatch(/['"`]\/(?:api\/)?(?:m7|legal)\//i);
    expect(m5Schema).not.toMatch(/(?:legal|m7)[A-Za-z0-9_]*(?:status)?\s*:/i);

    const flow = JSON.parse(flowFixture) as { nodes: Array<{ id: string; module: string }>; edges: Array<{ source: string; target: string }> };
    const modules = new Map(flow.nodes.map((node) => [node.id, node.module.toLowerCase()]));
    expect(flow.edges.some((edge) => [modules.get(edge.source), modules.get(edge.target)].sort().join('-') === 'm5-m7')).toBe(false);
    expect(gateway).not.toMatch(/set\s+\$upstream_legal\b/i);
    expect(gateway).toMatch(/set\s+\$upstream_m7\b/i);
    expect(compose).not.toMatch(/^\s{2}(?:m7|legal):/im);
  });
});
