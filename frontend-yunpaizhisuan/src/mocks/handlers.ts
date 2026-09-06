import { delay, http, HttpResponse, passthrough } from 'msw';
import bomPreviewHtml from './fixtures/bom-preview.html?raw';
import auditLogs from './fixtures/auditLogs.json';
import agentFlow from './fixtures/agentFlow.json';
import bomItems from './fixtures/bomItems.json';
import dashboard from './fixtures/dashboard.json';
import legalRisks from './fixtures/legalRisks.json';
import m1ReviewItems from './fixtures/m1ReviewItems.json';
import m1Tasks from './fixtures/m1Tasks.json';
import m2ParsedSop from './fixtures/m2ParsedSop.json';
import m2WorkflowResult from './fixtures/m2WorkflowResult.json';
import m4Alerts from './fixtures/m4Alerts.json';
import m4ImportBatch from './fixtures/m4ImportBatch.json';
import m4PurchaseOrders from './fixtures/m4PurchaseOrders.json';
import m4Suggestions from './fixtures/m4Suggestions.json';
import m4Suppliers from './fixtures/m4Suppliers.json';
import m4Tracking from './fixtures/m4Tracking.json';
import m5FlowDashboard from './fixtures/m5FlowDashboard.json';
import moduleStatuses from './fixtures/moduleStatuses.json';
import notificationsFixture from './fixtures/notifications.json';
import permissions from './fixtures/permissions.json';
import purchaseWarnings from './fixtures/purchaseWarnings.json';
import scheduleBoard from './fixtures/scheduleBoard.json';
import scheduleDependencies from './fixtures/scheduleDependencies.json';
import sopSteps from './fixtures/sopSteps.json';
import tasks from './fixtures/tasks.json';
import { getMockScenario, type MockScenario } from './scenarios/current';
import type { AuditLogItem, ScheduleBoard, TaskItem } from '../types/api';
import type { M4Alert, M4ImportBatch, M4PurchaseOrder, M4Supplier, M4SupplierReply, M4SuggestionItem, M4Tracking } from '../schemas/m4';
import type { M5FlowDashboardItem } from '../schemas/m5';
import type { AppNotification } from '../features/notifications/useNotificationStore';
import { uuid6 } from '../utils/uuid6';

const initialAuditLogs = auditLogs as AuditLogItem[];
let auditLogStore: AuditLogItem[] = [];
const initialM4Suppliers = m4Suppliers as M4Supplier[];
const initialM4ImportBatch = m4ImportBatch as M4ImportBatch;
const initialM4Suggestions = m4Suggestions as M4SuggestionItem[];
const initialM4PurchaseOrders = m4PurchaseOrders as M4PurchaseOrder[];
const initialM4Tracking = m4Tracking as M4Tracking[];
const initialM4Alerts = m4Alerts as M4Alert[];
const initialM5FlowDashboard = m5FlowDashboard as M5FlowDashboardItem[];
let m4SupplierStore: M4Supplier[] = [];
let m4PurchaseOrderStore: M4PurchaseOrder[] = [];
let m4AlertStore: M4Alert[] = [];
let m4ReplyStore: M4SupplierReply[] = [];
let m4ReplyIdSequence = 600;
const initialNotifications = notificationsFixture as AppNotification[];
let notificationStore: AppNotification[] = [];
let notificationPollCount = 0;

const initialTasks = tasks as TaskItem[];
let taskStore: TaskItem[] = [];

type MockChatConversation = {
  id: string; title: string; title_source: 'auto' | 'manual'; status: 'active';
  last_message_at: string | null; created_at: string; updated_at: string; version: number;
};
type MockChatMessage = {
  id: string; role: 'user' | 'assistant'; content: string; status: 'completed'; created_at: string;
  run: null | { id: string; status: 'completed'; finish_reason: 'stop'; usage: { input_tokens: number; output_tokens: number }; error: null; tool_steps: [] };
};
let chatConversationStore: MockChatConversation[] = [];
let chatMessageStore = new Map<string, MockChatMessage[]>();
type MockBusinessFlow = {
  runId: string;
  trackingTaskId: string;
  orderId: string;
  mode: 'real' | 'pressure_only';
};
let businessFlowStore = new Map<string, MockBusinessFlow>();

const m0ExtractDocuments = [
  {
    id: 1,
    batch_id: 'M0-BATCH-001',
    original_name: '订单-CAND-088.pdf',
    stored_name: 'order-cand-088.pdf',
    content_hash: 'm0-order-1',
    detected_format: 'pdf',
    declared_ext: 'pdf',
    domain: 'order',
    confidence: 0.98,
    status: 'ok',
    message: 'm1:extracted',
    row_count: 0,
    extract_status: 'done',
    extract_task_id: 'm1-task-order',
    extract_content: JSON.stringify({
      source: '订单-CAND-088.pdf',
      document_type: 'order',
      header: { doc_no: 'CAND-088', customer: 'CANDELIGHT', due_date: '2026-09-20' },
      lines: [{ model: 'HDMI-HDMI 扁平线 1.5M', qty: 5000 }],
      extractor: 'm0-rules-v1',
      status: 'ok',
    }),
  },
  {
    id: 2,
    batch_id: 'M0-BATCH-001',
    original_name: '加工BOM-成品A.xlsx',
    stored_name: 'bom-a.xlsx',
    content_hash: 'm0-bom-1',
    detected_format: 'xlsx',
    declared_ext: 'xlsx',
    domain: 'bom',
    confidence: 0.99,
    status: 'ok',
    message: '',
    row_count: 4,
    extract_status: 'done',
    extract_task_id: '',
    extract_content: JSON.stringify({
      model: '成品A-2080',
      items: [
        { material_code: '110200M', material_name: '锌合金外壳', qty: 1, loss_rate: 0.05 },
        { material_code: 'CABLE-2M', material_name: 'USB 线材', qty: 1, loss_rate: 0.08 },
        { material_code: 'SCREW-7144', material_name: '螺丝 M2', qty: 4, loss_rate: 0.02 },
      ],
    }),
  },
  {
    id: 3,
    batch_id: 'M0-BATCH-001',
    original_name: '图纸_ABC-123.pdf',
    stored_name: 'drawing-abc-123.pdf',
    content_hash: 'm0-drawing-1',
    detected_format: 'pdf',
    declared_ext: 'pdf',
    domain: 'drawing',
    confidence: 0.97,
    status: 'ok',
    message: 'm1:extracted',
    row_count: 0,
    extract_status: 'done',
    extract_task_id: 'm1-task-drawing',
    extract_content: JSON.stringify({
      source: '图纸_ABC-123.pdf',
      document_type: 'drawing',
      header: { drawing_no: 'ABC-123', part_no: 'PN-001' },
      lines: [],
      extractor: 'm0-rules-v1',
      status: 'ok',
    }),
  },
  {
    id: 4,
    batch_id: 'M0-BATCH-001',
    original_name: 'SOP-组装工序.pdf',
    stored_name: 'sop-assembly.pdf',
    content_hash: 'm0-sop-1',
    detected_format: 'pdf',
    declared_ext: 'pdf',
    domain: 'sop',
    confidence: 0.95,
    status: 'ok',
    message: 'm1:extracted',
    row_count: 0,
    extract_status: 'done',
    extract_task_id: 'm1-task-sop',
    extract_content: JSON.stringify({
      source: 'SOP-组装工序.pdf',
      document_type: 'sop',
      header: {},
      lines: [
        { step: '步骤1', content: '将线材穿入外壳，拉力 ≥ 5N' },
        { step: '步骤2', content: '焊接 USB 端子，温度 350±10℃' },
      ],
      extractor: 'm0-rules-v1',
      status: 'ok',
    }),
  },
  {
    id: 5,
    batch_id: 'M0-BATCH-001',
    original_name: '承认书-规格书.pdf',
    stored_name: 'spec-approval.pdf',
    content_hash: 'm0-spec-1',
    detected_format: 'pdf',
    declared_ext: 'pdf',
    domain: 'specification',
    confidence: 0.96,
    status: 'ok',
    message: 'm1:extracted',
    row_count: 0,
    extract_status: 'done',
    extract_task_id: 'm1-task-spec',
    extract_content: JSON.stringify({
      source: '承认书-规格书.pdf',
      document_type: 'specification',
      header: { product_spec: 'HDMI 线材 1.5M', core_count: '4C', conductor: '22AWG', insulation: 'PVC', twist_pitch: '10mm' },
      lines: [],
      extractor: 'm0-rules-v1',
      status: 'ok',
    }),
  },
  {
    id: 6,
    batch_id: 'M0-BATCH-001',
    original_name: '采购订单-PO-20260801.pdf',
    stored_name: 'po-20260801.pdf',
    content_hash: 'm0-po-1',
    detected_format: 'pdf',
    declared_ext: 'pdf',
    domain: 'po',
    confidence: 0.97,
    status: 'ok',
    message: 'm1:extracted',
    row_count: 0,
    extract_status: 'done',
    extract_task_id: 'm1-task-po',
    extract_content: JSON.stringify({
      source: '采购订单-PO-20260801.pdf',
      document_type: 'po',
      header: { doc_no: 'PO-20260801', supplier: '华东供应商' },
      lines: [{ model: '锌合金外壳', qty: 2000, due_date: '2026-09-01' }],
      extractor: 'm0-rules-v1',
      status: 'ok',
    }),
  },
  {
    id: 7,
    batch_id: 'M0-BATCH-001',
    original_name: '设备清单-待确认.pdf',
    stored_name: 'machine-unclear.pdf',
    content_hash: 'm0-machine-1',
    detected_format: 'pdf',
    declared_ext: 'pdf',
    domain: 'equipment',
    confidence: 0.62,
    status: 'needs_review',
    message: 'm1:needs_review',
    row_count: 0,
    extract_status: 'needs_review',
    extract_task_id: 'm1-task-machine',
    extract_content: '',
  },
];

const mockChatId = () => globalThis.crypto.randomUUID();
const mockChatTitle = (message: string) => {
  const value = message.trim().replace(/\s+/g, ' ');
  return value.length > 120 ? `${value.slice(0, 117)}...` : value || '新对话';
};
const createMockChatConversation = (title: string, titleSource: 'auto' | 'manual' = 'manual') => {
  const timestamp = new Date().toISOString();
  const conversation: MockChatConversation = {
    id: uuid6(), title, title_source: titleSource, status: 'active', last_message_at: timestamp,
    created_at: timestamp, updated_at: timestamp, version: 1,
  };
  chatConversationStore = [conversation, ...chatConversationStore];
  chatMessageStore.set(conversation.id, []);
  return conversation;
};

export const resetMockAuditLogs = () => {
  auditLogStore = initialAuditLogs.map((item) => ({ ...item }));
};

export const resetMockM4State = () => {
  m4SupplierStore = initialM4Suppliers.map((item) => ({ ...item }));
  m4PurchaseOrderStore = initialM4PurchaseOrders.map((item) => ({ ...item, items: item.items.map((orderItem) => ({ ...orderItem })) }));
  m4AlertStore = initialM4Alerts.map((item) => ({ ...item }));
  m4ReplyStore = [];
  m4ReplyIdSequence = 600;
};

export const resetMockChatHistory = () => {
  chatConversationStore = [];
  chatMessageStore = new Map<string, MockChatMessage[]>();
};

export const resetMockBusinessFlows = () => {
  businessFlowStore = new Map<string, MockBusinessFlow>();
};

export const resetMockNotifications = () => {
  notificationStore = initialNotifications.map((item) => ({ ...item }));
  notificationPollCount = 0;
};

export const resetMockTaskState = () => {
  taskStore = initialTasks.map((item) => ({ ...item }));
};

resetMockAuditLogs();
resetMockM4State();
resetMockChatHistory();
resetMockBusinessFlows();
resetMockNotifications();
resetMockTaskState();

type ScenarioGetter = () => MockScenario;

const serverError = () => HttpResponse.json({ message: 'Mock server error' }, { status: 500 });
const forbidden = () => HttpResponse.json({ message: 'No permission' }, { status: 403 });
// M5 业务路由默认响应类为 EnvelopeJSONResponse：{ success, data, errors, trace_id }。
const m5Envelope = (data: unknown) => ({ success: true, data, errors: [], trace_id: 'msw-m5-trace' });
const permissionFixture = permissions as {
  currentRoleId: string;
  permissionDeniedRoleId: string;
  roles: Array<{ id: string; name: string; permissions: string[] }>;
};

const getMockRole = (scenario: MockScenario) => {
  const roleId =
    scenario === 'permissionDenied'
      ? permissionFixture.permissionDeniedRoleId
      : typeof window !== 'undefined'
        ? window.localStorage.getItem('mockRoleId') ?? permissionFixture.currentRoleId
        : permissionFixture.currentRoleId;

  return (
    permissionFixture.roles.find((role) => role.id === roleId) ??
    permissionFixture.roles.find((role) => role.id === permissionFixture.currentRoleId) ??
    permissionFixture.roles[0]
  );
};

const emptyScheduleBoard: ScheduleBoard = {
  resources: [],
  tasks: [],
  conflicts: [],
};

const toNumberParam = (value: string | null, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const toPage = <T,>(items: T[], request: Request) => {
  const url = new URL(request.url);
  const page = toNumberParam(url.searchParams.get('page'), 1);
  const pageSize = toNumberParam(url.searchParams.get('page_size'), 20);
  const start = (page - 1) * pageSize;

  return {
    items: items.slice(start, start + pageSize),
    page,
    page_size: pageSize,
    total: items.length,
  };
};

const matchesText = (value: string | null | undefined, keyword: string | null) => {
  if (!keyword) {
    return true;
  }
  return value?.toLowerCase().includes(keyword.toLowerCase()) ?? false;
};

const m4AlertsCsv = (items: M4Alert[]) =>
  [
    'id,alert_type,purchase_order_no,supplier_name,item_code,item_name,promised_date,days_overdue,status',
    ...items.map((item) =>
      [
        item.id,
        item.alert_type,
        item.purchase_order_no,
        item.supplier_name,
        item.item_code,
        item.item_name,
        item.promised_date,
        item.days_overdue,
        item.status,
      ].join(','),
    ),
  ].join('\n');

const m4TrackingCsv = (items: M4Tracking[]) =>
  [
    'id,purchase_order_item_id,promised_date,unit_price,currency,exception_type,arrival_status,is_overdue',
    ...items.map((item) =>
      [
        item.id,
        item.purchase_order_item_id,
        item.promised_date ?? '',
        item.unit_price ?? '',
        item.currency ?? '',
        item.exception_type ?? '',
        item.arrival_status,
        item.is_overdue,
      ].join(','),
    ),
  ].join('\n');

const firstM4Supplier = () => m4SupplierStore[0] ?? initialM4Suppliers[0]!;
const firstM4PurchaseOrder = () => m4PurchaseOrderStore[0] ?? initialM4PurchaseOrders[0]!;
const firstM4Alert = () => m4AlertStore[0] ?? initialM4Alerts[0]!;

async function resolveScenario(getScenario: ScenarioGetter) {
  const scenario = getScenario();
  if (scenario === 'timeout') {
    await delay(20_000);
  }
  return scenario;
}

async function guardedScenario(
  getScenario: ScenarioGetter,
  options: { allowPermissionDenied?: boolean; allowError?: boolean } = {},
) {
  const scenario = await resolveScenario(getScenario);

  if (scenario === 'error' && !options.allowError) {
    return { scenario, response: serverError() };
  }

  if (scenario === 'permissionDenied' && !options.allowPermissionDenied) {
    return { scenario, response: forbidden() };
  }

  return { scenario, response: null };
}

export const createHandlers = (getScenario: ScenarioGetter = getMockScenario) => [
  http.get('/historical-order-catalog.json', () =>
    HttpResponse.json([
      {
        catalog_id: 'hist-catalog-008',
        order_id: 'SO-HIST-008',
        product_name: 'HDMI 线缆',
        status: '已验收',
        task_id: 'task-hist-008',
      },
      {
        catalog_id: 'hist-catalog-080',
        order_id: 'SO-HIST-080',
        product_name: 'USB 线缆',
        status: '待运行',
      },
    ]),
  ),
  http.get('/run-config/candidate-run-manifest.json', () =>
    HttpResponse.json([
      { catalog_id: 'hist-catalog-008', title: 'HDMI 线缆', order: { order_id: 'SO-HIST-008' } },
      { catalog_id: 'hist-catalog-080', title: 'USB 线缆', order: { order_id: 'SO-HIST-080' } },
    ]),
  ),
  http.get('/api/orchestrator/tracking/tasks/:taskId/snapshot', ({ params }) => {
    const taskId = String(params.taskId);
    if (taskId !== 'task-hist-008') {
      return HttpResponse.json({ task_id: taskId, status: 'unknown', module_runs: [], entities: [] });
    }
    return HttpResponse.json({
      task_id: taskId,
      status: 'success',
      module_runs: [
        { module: 'm1', status: 'done' },
        { module: 'm2', status: 'done' },
        { module: 'm3', status: 'done' },
        { module: 'm4', status: 'done' },
        { module: 'm5', status: 'running' },
      ],
      entities: [
        { entity_id: 'bom-1', entity_type: 'bom', module: 'm2', status: 'done', metadata: { bom_lines: [{}] } },
        { entity_id: 'plan-1', entity_type: 'procurement_plan', module: 'm3', status: 'done', metadata: { shortage_lines: 2 } },
        { entity_id: 'sugg-1', entity_type: 'purchase_suggestion', module: 'm4', status: 'done' },
      ],
      events: [],
    });
  }),
  http.get('/api/orchestrator/chat/conversations', ({ request }) => {
    if (import.meta.env.DEV) return passthrough();
    const query = new URL(request.url).searchParams.get('q')?.trim().toLocaleLowerCase();
    const items = [...chatConversationStore]
      .filter((conversation) => !query || conversation.title.toLocaleLowerCase().includes(query))
      .sort((left, right) => (right.last_message_at ?? right.created_at).localeCompare(left.last_message_at ?? left.created_at));
    return HttpResponse.json({ items, next_cursor: null });
  }),
  http.post('/api/orchestrator/chat/conversations', async ({ request }) => {
    if (import.meta.env.DEV) return passthrough();
    const body = (await request.json().catch(() => ({}))) as { title?: string };
    const title = mockChatTitle(body.title ?? '新对话');
    return HttpResponse.json(
      createMockChatConversation(title, title === '新对话' ? 'auto' : 'manual'),
      { status: 201 },
    );
  }),
  http.get('/api/orchestrator/chat/conversations/:conversationId/messages', ({ params }) => {
    if (import.meta.env.DEV) return passthrough();
    const conversationId = String(params.conversationId);
    if (!chatMessageStore.has(conversationId)) return HttpResponse.json({ detail: { code: 'conversation_not_found' } }, { status: 404 });
    return HttpResponse.json({ items: chatMessageStore.get(conversationId) ?? [], next_cursor: null });
  }),
  http.patch('/api/orchestrator/chat/conversations/:conversationId', async ({ params, request }) => {
    if (import.meta.env.DEV) return passthrough();
    const conversationId = String(params.conversationId);
    const body = (await request.json().catch(() => ({}))) as { title?: string; version?: number };
    const current = chatConversationStore.find((conversation) => conversation.id === conversationId);
    if (!current) return HttpResponse.json({ detail: { code: 'conversation_not_found' } }, { status: 404 });
    if (body.version !== current.version) return HttpResponse.json({ detail: { code: 'version_conflict' } }, { status: 409 });
    const updated: MockChatConversation = {
      ...current, title: mockChatTitle(body.title ?? ''), title_source: 'manual', version: current.version + 1, updated_at: new Date().toISOString(),
    };
    chatConversationStore = chatConversationStore.map((conversation) => conversation.id === conversationId ? updated : conversation);
    return HttpResponse.json(updated);
  }),
  http.delete('/api/orchestrator/chat/conversations/:conversationId', ({ params, request }) => {
    if (import.meta.env.DEV) return passthrough();
    const conversationId = String(params.conversationId);
    const current = chatConversationStore.find((conversation) => conversation.id === conversationId);
    if (!current) return HttpResponse.json({ detail: { code: 'conversation_not_found' } }, { status: 404 });
    if (Number(request.headers.get('If-Match')) !== current.version) return HttpResponse.json({ detail: { code: 'version_conflict' } }, { status: 409 });
    chatConversationStore = chatConversationStore.filter((conversation) => conversation.id !== conversationId);
    chatMessageStore.delete(conversationId);
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('/api/auth/me', async () => {
    const scenario = await resolveScenario(getScenario);
    if (scenario === 'error') {
      return serverError();
    }

    return HttpResponse.json({ role: getMockRole(scenario) });
  }),
  http.get('/api/dashboard/summary', async () => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json(
      scenario === 'empty'
        ? { modules: [], activities: [], risks: [] }
        : {
            modules: moduleStatuses,
            activities: dashboard.activities,
            risks: dashboard.risks,
          },
    );
  }),
  http.get('/api/dashboard/module-statuses', async () => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json(scenario === 'empty' ? [] : moduleStatuses);
  }),
  http.get('/api/tasks', async () => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json(scenario === 'empty' ? [] : taskStore);
  }),
  http.get('/api/orchestrator/tasks', async () => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json([]);
  }),
  http.patch('/api/tasks/:id', async ({ params, request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    const id = String(params.id);
    const body = (await request.json().catch(() => ({}))) as Partial<TaskItem>;
    const current = taskStore.find((item) => item.id === id);
    if (!current) {
      return HttpResponse.json({ detail: { code: 'task_not_found' } }, { status: 404 });
    }
    const updated: TaskItem = { ...current, ...body, id };
    taskStore = taskStore.map((item) => (item.id === id ? updated : item));
    auditLogStore = [
      {
        id: `LOG-TASK-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        time: new Date().toISOString(),
        actor: 'demo-user',
        action: 'TASK_UPDATE',
        module: '任务看板',
        targetId: id,
        result: 'success',
        detail: `更新任务：${current.title}`,
      },
      ...auditLogStore,
    ];
    return HttpResponse.json(updated);
  }),
  http.get('/api/audit/logs', async () => {
    const { scenario, response } = await guardedScenario(getScenario, { allowPermissionDenied: true });
    if (response) {
      return response;
    }
    return HttpResponse.json(scenario === 'empty' ? [] : auditLogStore);
  }),
  http.post('/api/audit/logs', async ({ request }) => {
    const { response } = await guardedScenario(getScenario, { allowPermissionDenied: true });
    if (response) {
      return response;
    }
    const log = (await request.json()) as AuditLogItem;
    auditLogStore = [log, ...auditLogStore];
    return HttpResponse.json(log, { status: 201 });
  }),
  http.get('/api/notifications', async () => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    notificationPollCount += 1;
    // 轮询 mock 模拟新通知到达：每 2 次轮询追加一条系统到达通知。
    if (notificationPollCount > 1 && notificationPollCount % 2 === 0) {
      const arrival: AppNotification = {
        id: `mock-arrival-${notificationPollCount}`,
        type: 'system_arrival',
        title: `模拟到达通知 ${notificationPollCount / 2}`,
        detail: '轮询 mock 模拟新通知到达（演示）',
        severity: 'info',
        link: '/dashboard',
        source: 'system',
        createdAt: new Date().toISOString(),
      };
      notificationStore = [arrival, ...notificationStore];
    }
    return HttpResponse.json(scenario === 'empty' ? [] : notificationStore);
  }),
  http.get('/api/flow/agent', async () => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json(scenario === 'empty' ? { nodes: [], edges: [] } : agentFlow);
  }),
  // 业务追溯工作台走真实本地编排器（浏览器验收用 passthrough 到 vite 代理）。
  http.all('/api/orchestrator/business-orders/:orderId/trace', () => passthrough()),
  http.all('/api/orchestrator/business-materials/:materialId/trace', () => passthrough()),
  http.all('/api/orchestrator/business-cost-variance', () => passthrough()),
  http.all('/api/orchestrator/business-finished-goods', () => passthrough()),
  http.all('/api/orchestrator/business-consumption-variance', () => passthrough()),
  http.all('/api/orchestrator/business-consumption-variance/refresh', () => passthrough()),
  http.all('/api/orchestrator/business-orders/:orderId/outbound-flow', () => passthrough()),
  http.all('/api/orchestrator/business-flows/:runId/outbound-flow', () => passthrough()),
  http.all('/api/orchestrator/business-facts', () => passthrough()),
  http.all('/api/orchestrator/business-execution-outputs', () => passthrough()),
  http.post('/api/orchestrator/business-flows', async ({ request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    const body = (await request.json().catch(() => ({}))) as {
      order_id?: string;
      mode?: 'real' | 'pressure_only';
    };
    const orderId = body.order_id?.trim() || 'MOCK-ORDER';
    const runId = `mock-flow-${uuid6()}`;
    const trackingTaskId = request.headers.get('X-Yunpai-Task-ID') || `task-${uuid6()}`;
    const flow: MockBusinessFlow = {
      runId,
      trackingTaskId,
      orderId,
      mode: body.mode ?? 'real',
    };
    businessFlowStore.set(runId, flow);
    return HttpResponse.json(
      {
        run_id: runId,
        tracking_task_id: trackingTaskId,
        order_id: orderId,
        mode: flow.mode,
        status: 'queued',
        current_node: 'intake',
      },
      { status: 202 },
    );
  }),
  http.get('/api/orchestrator/business-flows/:runId', ({ params }) => {
    const flow = businessFlowStore.get(String(params.runId));
    if (!flow) {
      return HttpResponse.json({ detail: { code: 'business_flow_not_found' } }, { status: 404 });
    }
    return HttpResponse.json({
      run_id: flow.runId,
      tracking_task_id: flow.trackingTaskId,
      requested_order_id: flow.orderId,
      order_id: flow.orderId,
      mode: flow.mode,
      status: 'human_input_required',
      current_node: 'resolve_or_generate_bom',
      blocked_reason: {
        code: 'MOCK_REVIEW_REQUIRED',
        message: '演示环境未提供已审核 BOM；请补充权威业务事实后在真实环境继续。',
      },
      steps: [],
    });
  }),
  http.post('/api/orchestrator/business-flows/:runId/resume', ({ params }) => {
    const flow = businessFlowStore.get(String(params.runId));
    if (!flow) {
      return HttpResponse.json({ detail: { code: 'business_flow_not_found' } }, { status: 404 });
    }
    return HttpResponse.json(
      {
        resumed: true,
        run_id: flow.runId,
        tracking_task_id: flow.trackingTaskId,
        order_id: flow.orderId,
        status: 'queued',
        current_node: 'intake',
      },
      { status: 202 },
    );
  }),
  http.get('/api/orchestrator/business-orders/:orderId/trace', ({ params }) => {
    const orderId = String(params.orderId);
    const runs = [...businessFlowStore.values()].filter((flow) => flow.orderId === orderId);
    return HttpResponse.json({
      tenant_id: 'mock-tenant',
      order_id: orderId,
      order: { order_id: orderId, lifecycle_status: 'human_input_required' },
      materials: [],
      order_materials: [],
      inventory_balances: [],
      inventory_movements: [],
      procurement_plans: [],
      procurement_plan_lines: [],
      purchase_orders: [],
      schedule_versions: [],
      business_flow_runs: runs.map((flow) => ({
        run_id: flow.runId,
        tracking_task_id: flow.trackingTaskId,
        status: 'human_input_required',
      })),
    });
  }),
  http.post('/api/orchestrator/chat/stream', async ({ request }) => {
    if (import.meta.env.DEV) return passthrough();
    const body = (await request.json().catch(() => ({}))) as { message?: string; conversation_id?: string };
    if (body.message === '触发错误态') {
      return HttpResponse.text('企业助手服务暂不可用', { status: 503 });
    }
    if (body.message === '生成一份长报告') {
      await delay(2_000);
    }
    const message = body.message?.trim() || '检查当前状态';
    let conversation = body.conversation_id
      ? chatConversationStore.find((item) => item.id === body.conversation_id)
      : undefined;
    if (!conversation) conversation = createMockChatConversation(mockChatTitle(message), 'auto');
    else if (conversation.title_source === 'auto' && conversation.title === '新对话') {
      conversation = { ...conversation, title: mockChatTitle(message) };
    }
    const timestamp = new Date().toISOString();
    const userMessageId = mockChatId();
    const assistantMessageId = mockChatId();
    const runId = mockChatId();
    const answer = '当前风险主要集中在采购交期和库存齐套。';
    const existingMessages = chatMessageStore.get(conversation.id) ?? [];
    chatMessageStore.set(conversation.id, [...existingMessages,
      { id: userMessageId, role: 'user', content: message, status: 'completed', created_at: timestamp, run: null },
      { id: assistantMessageId, role: 'assistant', content: answer, status: 'completed', created_at: timestamp,
        run: { id: runId, status: 'completed', finish_reason: 'stop', usage: { input_tokens: 0, output_tokens: 0 }, error: null, tool_steps: [] } },
    ]);
    conversation = { ...conversation, last_message_at: timestamp, updated_at: timestamp, version: conversation.version + 1 };
    chatConversationStore = [conversation, ...chatConversationStore.filter((item) => item.id !== conversation.id)];
    return HttpResponse.text(
      [
        JSON.stringify({ type: 'message_start', message_id: assistantMessageId, session_id: 'mock-session', conversation_id: conversation.id,
          created_at: timestamp, user_message_id: userMessageId, assistant_message_id: assistantMessageId, run_id: runId,
          conversation_version: conversation.version, conversation_title: conversation.title,
          conversation_title_source: conversation.title_source }),
        JSON.stringify({ type: 'delta', message_id: assistantMessageId, content: answer }),
        JSON.stringify({ type: 'message_done', message_id: assistantMessageId, finish_reason: 'stop', usage: { input_tokens: 0, output_tokens: 0 } }),
      ].join('\n') + '\n',
      { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } },
    );
  }),
  http.post('/api/orchestrator/chat/follow-ups', async () =>
    HttpResponse.json({
      questions: ['哪些订单存在延期风险？', '帮我排查本周排程冲突', '汇总最近的采购预警'],
      source: 'llm',
    }),
  ),
  http.post('/api/orchestrator/invoke', async ({ request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    const body = (await request.json().catch(() => ({}))) as { session_id?: string };
    return HttpResponse.json({
      job_id: 'orch-job-001',
      status: 'running',
      tools_to_use: ['list_m5_schedules'],
      session_id: body.session_id ?? 'mock-session',
    });
  }),
  http.get('/api/orchestrator/jobs', async () =>
    HttpResponse.json({
      items: [
        {
          job_id: 'orch-job-001',
          status: 'done',
          tools_to_use: ['list_m5_schedules'],
          session_id: 'mock-session',
          steps: [],
          result: { content: '编排任务已完成。' },
        },
      ],
      total: 1,
    }),
  ),
  http.get('/api/orchestrator/jobs/:id', async ({ params }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json({
      job_id: String(params.id),
      status: 'done',
      tools_to_use: ['list_m5_schedules'],
      session_id: 'mock-session',
      steps: [
        {
          tool: 'list_m5_schedules',
          status: 'ok',
          duration_ms: 18.5,
          result: { items: [{ schedule_id: 'S-001' }] },
        },
      ],
      result: { content: '编排任务已完成。' },
    });
  }),
  http.get('/api/orchestrator/memory/similar', async () => HttpResponse.json({ items: [] })),
  http.get('/api/m0/parser-compat/tasks', async () => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json(scenario === 'empty' ? [] : m1Tasks);
  }),
  http.get('/api/m0/parser-compat/tasks/:id', async ({ params }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json(m1Tasks.find((task) => task.id === params.id) ?? m1Tasks[0]);
  }),
  http.get('/api/m0/parser-compat/batch/:parentId', async () => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json(scenario === 'empty' ? [] : m1Tasks);
  }),
  http.get('/api/m0/parser-compat/files/:taskId', async () =>
    HttpResponse.arrayBuffer(new TextEncoder().encode('mock file preview').buffer, {
      headers: { 'Content-Type': 'application/octet-stream' },
    }),
  ),
  http.get('/api/m0/parser-compat/review/queue', async () => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json(scenario === 'empty' ? [] : m1ReviewItems);
  }),
  http.post('/api/m0/parser-compat/ingest', async () => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json({ taskId: 'M1-TASK-001' }, { status: 202 });
  }),
  http.post('/api/m0/parser-compat/ingest/sync', async () => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json({ taskId: 'M1-TASK-SYNC-001', status: 'completed' });
  }),
  http.post('/api/m0/parser-compat/ingest/batch', async () => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json(
      {
        taskIds: ['M1-TASK-003', 'M1-TASK-004'],
        failedFiles: [{ filename: '结构图-损坏.dwg', reason: '文件损坏，无法解析' }],
      },
      { status: 202 },
    );
  }),
  http.post('/api/m0/parser-compat/ingest/archive', async () => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json(
      {
        taskId: 'M1-TASK-ZIP-001',
        extractedFiles: 8,
        failedFiles: [{ filename: '旧版工艺卡.xls', reason: '压缩包内文件类型不支持' }],
      },
      { status: 202 },
    );
  }),
  http.post('/api/m0/parser-compat/review/:id', async ({ params, request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    const body = (await request.json().catch(() => null)) as Record<string, string> | null;
    const item = m1ReviewItems.find((candidate) => candidate.taskId === params.id) ?? m1ReviewItems[0];
    if (!item) {
      return HttpResponse.json({ message: 'Review item not found' }, { status: 404 });
    }
    return HttpResponse.json({
      ...item,
      correctedValue: body?.[item.field] ?? item.recognizedValue,
      status: 'confirmed',
    });
  }),
  http.post('/api/m0/parser-compat/tasks/:taskId/report', async ({ params }) =>
    HttpResponse.json({ taskId: String(params.taskId), reportId: 'M1-RPT-001', status: 'generated' }),
  ),
  http.get('/api/m0/parser-compat/tasks/:taskId/report/download', async () =>
    HttpResponse.arrayBuffer(new TextEncoder().encode('mock report').buffer, {
      headers: { 'Content-Type': 'application/pdf' },
    }),
  ),
  http.delete('/api/m0/parser-compat/tasks/:taskId', async ({ params }) => HttpResponse.json({ taskId: String(params.taskId), deleted: true })),
  http.get('/api/demo/bom/items', async () => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json(scenario === 'empty' ? [] : bomItems);
  }),
  http.post('/api/demo/bom/items/:id/review', async ({ params, request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    const body = (await request.json()) as { status: 'approved' | 'rejected' };
    const item = bomItems.find((entry) => entry.id === params.id) ?? bomItems[0];
    return HttpResponse.json({ ...item, status: body.status });
  }),
  http.get('/api/demo/sop/steps', async () => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json(scenario === 'empty' ? [] : sopSteps);
  }),
  http.get('/api/demo/purchase/warnings', async () => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json(scenario === 'empty' ? [] : purchaseWarnings);
  }),
  http.post('/api/demo/purchase/warnings/:id/follow', async ({ params }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    const item = purchaseWarnings.find((entry) => entry.id === params.id) ?? purchaseWarnings[0];
    return HttpResponse.json({ ...item, status: 'followed' });
  }),
  http.get('/api/m4/suppliers', async ({ request }) => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    if (scenario === 'empty') {
      return HttpResponse.json(toPage([], request));
    }

    const url = new URL(request.url);
    const supplierName = url.searchParams.get('supplier_name');
    const items = m4SupplierStore.filter((item) => matchesText(item.supplier_name, supplierName));
    return HttpResponse.json(toPage(items, request));
  }),
  http.post('/api/m4/suppliers', async ({ request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    const body = (await request.json()) as Omit<M4Supplier, 'id'>;
    const supplier = { id: m4SupplierStore.length + 1, ...body };
    m4SupplierStore = [supplier, ...m4SupplierStore];
    return HttpResponse.json(supplier, { status: 201 });
  }),
  http.patch('/api/m4/suppliers/:id', async ({ params, request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    const id = Number(params.id);
    const body = (await request.json()) as Partial<M4Supplier>;
    const current = m4SupplierStore.find((item) => item.id === id) ?? firstM4Supplier();
    const updated = { ...current, ...body, id };
    m4SupplierStore = m4SupplierStore.map((item) => (item.id === id ? updated : item));
    return HttpResponse.json(updated);
  }),
  http.post('/api/m4/import-batches', async ({ request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    const formData = await request.formData();
    const file = formData.get('file');
    const filename = typeof File !== 'undefined' && file instanceof File ? file.name : initialM4ImportBatch.filename;
    return HttpResponse.json({ ...initialM4ImportBatch, filename }, { status: 201 });
  }),
  http.get('/api/m4/import-batches/:id', async () => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json(
      scenario === 'empty'
        ? { ...initialM4ImportBatch, total_rows: 0, valid_rows: 0, invalid_rows: 0, duplicate_rows: 0, items: [] }
        : initialM4ImportBatch,
    );
  }),
  http.post(/\/api\/m4\/suggestions\/import-json$/, async ({ request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    await request.json().catch(() => ({}));
    return HttpResponse.json(initialM4Suggestions);
  }),
  http.get('/api/m4/suggestions', async ({ request }) => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    if (scenario === 'empty') {
      return HttpResponse.json(toPage([], request));
    }

    const url = new URL(request.url);
    const batchId = url.searchParams.get('batch_id');
    const supplierName = url.searchParams.get('supplier_name');
    const itemCode = url.searchParams.get('item_code');
    const validationStatus = url.searchParams.get('validation_status');
    const items = initialM4Suggestions.filter(
      (item) =>
        (!batchId || item.batch_id === Number(batchId)) &&
        matchesText(item.supplier_name, supplierName) &&
        matchesText(item.item_code, itemCode) &&
        (!validationStatus || item.validation_status === validationStatus),
    );

    return HttpResponse.json(toPage(items, request));
  }),
  http.post('/api/m4/purchase-orders/generate', async ({ request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    const body = (await request.json()) as { suggestion_item_ids: number[] };
    const generated = m4PurchaseOrderStore.filter((item) =>
      item.items.some((orderItem) => body.suggestion_item_ids.includes(orderItem.id - 200)),
    );
    return HttpResponse.json(generated.length > 0 ? generated : [firstM4PurchaseOrder()]);
  }),
  http.get('/api/m4/purchase-orders', async ({ request }) => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    if (scenario === 'empty') {
      return HttpResponse.json(toPage([], request));
    }

    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const supplierName = url.searchParams.get('supplier_name');
    const items = m4PurchaseOrderStore.filter(
      (item) => (!status || item.status === status) && matchesText(item.supplier_name, supplierName),
    );
    return HttpResponse.json(toPage(items, request));
  }),
  http.get('/api/m4/purchase-orders/:id', async ({ params }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    const id = Number(params.id);
    return HttpResponse.json(m4PurchaseOrderStore.find((item) => item.id === id) ?? firstM4PurchaseOrder());
  }),
  http.patch('/api/m4/purchase-orders/:id', async ({ params, request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    const id = Number(params.id);
    const body = (await request.json()) as Partial<M4PurchaseOrder>;
    const current = m4PurchaseOrderStore.find((item) => item.id === id) ?? firstM4PurchaseOrder();
    const updated = { ...current, ...body, id };
    m4PurchaseOrderStore = m4PurchaseOrderStore.map((item) => (item.id === id ? updated : item));
    return HttpResponse.json(updated);
  }),
  http.post('/api/m4/purchase-orders/:id/submit-review', async ({ params, request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    await request.json().catch(() => ({}));
    const id = Number(params.id);
    const current = m4PurchaseOrderStore.find((item) => item.id === id) ?? firstM4PurchaseOrder();
    const updated: M4PurchaseOrder = { ...current, status: 'pending_review' };
    m4PurchaseOrderStore = m4PurchaseOrderStore.map((item) => (item.id === id ? updated : item));
    return HttpResponse.json(updated);
  }),
  http.post('/api/m4/purchase-orders/:id/approve', async ({ params, request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    await request.json().catch(() => ({}));
    const id = Number(params.id);
    const current = m4PurchaseOrderStore.find((item) => item.id === id) ?? firstM4PurchaseOrder();
    const updated: M4PurchaseOrder = { ...current, status: 'pending_send' };
    m4PurchaseOrderStore = m4PurchaseOrderStore.map((item) => (item.id === id ? updated : item));
    return HttpResponse.json(updated);
  }),
  http.post('/api/m4/purchase-orders/:id/reject', async ({ params, request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    await request.json().catch(() => ({}));
    const id = Number(params.id);
    const current = m4PurchaseOrderStore.find((item) => item.id === id) ?? firstM4PurchaseOrder();
    const updated: M4PurchaseOrder = { ...current, status: 'rejected' };
    m4PurchaseOrderStore = m4PurchaseOrderStore.map((item) => (item.id === id ? updated : item));
    return HttpResponse.json(updated);
  }),
  http.post('/api/m4/purchase-orders/:id/inquiry-message', async ({ params, request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    const body = (await request.json().catch(() => ({}))) as { channel?: string };
    const id = Number(params.id);
    const order = m4PurchaseOrderStore.find((item) => item.id === id) ?? firstM4PurchaseOrder();
    return HttpResponse.json({
      message_id: 700 + id,
      subject: `采购询价 ${order.purchase_order_no}`,
      content: `您好，请协助确认采购单 ${order.purchase_order_no} 的报价、预计交期和供货风险。`,
      channel: body.channel ?? 'email',
      recipient: null,
      send_status: 'generated',
      model_name: 'mock-agent',
      prompt_version: 'inquiry-message-v1',
    });
  }),
  http.post('/api/m4/purchase-orders/:id/send', async ({ params, request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    await request.json().catch(() => ({}));
    const id = Number(params.id);
    const current = m4PurchaseOrderStore.find((item) => item.id === id) ?? firstM4PurchaseOrder();
    const updated: M4PurchaseOrder = {
      ...current,
      status: 'sent',
      items: current.items.map((item) => ({ ...item, status: 'sent' })),
    };
    m4PurchaseOrderStore = m4PurchaseOrderStore.map((item) => (item.id === id ? updated : item));
    return HttpResponse.json({ ...updated, record_only: true });
  }),
  http.post('/api/m4/replies', async ({ request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    const body = (await request.json()) as Omit<M4SupplierReply, 'id'>;
    const reply: M4SupplierReply = { id: ++m4ReplyIdSequence, ...body };
    m4ReplyStore = [reply, ...m4ReplyStore];
    return HttpResponse.json(reply, { status: 201 });
  }),
  http.post('/api/m4/replies/:id/parse', async ({ params }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    const id = Number(params.id);
    const reply = m4ReplyStore.find((item) => item.id === id);
    const lowConfidence = reply?.reply_content.includes('不确定') ?? true;
    return HttpResponse.json({
      delivery_date: '2026-07-25',
      unit_price: '12.50',
      currency: 'CNY',
      tax_included: true,
      exception_type: 'delivery_delay',
      exception_description: '供应商库存不足，交期延后',
      confidence: lowConfidence ? 0.62 : 0.86,
      need_human_review: lowConfidence,
    });
  }),
  http.post('/api/m4/replies/:id/confirm', async ({ request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      ...body,
      confidence: 1,
      need_human_review: false,
    });
  }),
  http.get('/api/m4/tracking', async ({ request }) => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json(toPage(scenario === 'empty' ? [] : initialM4Tracking, request));
  }),
  http.get('/api/m4/tracking/export.csv', async () => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.text(m4TrackingCsv(scenario === 'empty' ? [] : initialM4Tracking), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename=m4_tracking.csv',
      },
    });
  }),
  http.post('/api/m4/alerts/scan', async () => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json({ scanned: initialM4Tracking.length, created: 1 });
  }),
  http.get('/api/m4/alerts', async ({ request }) => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    if (scenario === 'empty') {
      return HttpResponse.json(toPage([], request));
    }

    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const alertType = url.searchParams.get('alert_type');
    const items = m4AlertStore.filter((item) => (!status || item.status === status) && (!alertType || item.alert_type === alertType));
    return HttpResponse.json(toPage(items, request));
  }),
  http.post('/api/m4/alerts/:id/urge-message', async ({ params, request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    const body = (await request.json().catch(() => ({}))) as { channel?: string };
    const id = Number(params.id);
    const current = m4AlertStore.find((item) => item.id === id) ?? firstM4Alert();
    const urgeMessage = `您好，麻烦确认采购单 ${current.purchase_order_no} 中${current.item_name}的当前交付进度、预计可交付日期和风险原因。`;
    m4AlertStore = m4AlertStore.map((item) => (item.id === id ? { ...item, urge_message: urgeMessage } : item));
    return HttpResponse.json({
      alert_id: id,
      urge_message: urgeMessage,
      channel: body.channel ?? 'wechat',
      model_name: 'mock-agent',
      prompt_version: 'urge-message-v1',
    });
  }),
  http.post('/api/m4/alerts/:id/status', async ({ params, request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    const id = Number(params.id);
    const body = (await request.json()) as { status: M4Alert['status'] };
    const current = m4AlertStore.find((item) => item.id === id) ?? firstM4Alert();
    const updated = { ...current, status: body.status };
    m4AlertStore = m4AlertStore.map((item) => (item.id === id ? updated : item));
    return HttpResponse.json(updated);
  }),
  http.get('/api/m4/alerts/export.csv', async () => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.text(m4AlertsCsv(scenario === 'empty' ? [] : m4AlertStore), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename=m4_alerts.csv',
      },
    });
  }),
  http.get('/api/demo/legal/risks', async () => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json(scenario === 'empty' ? [] : legalRisks);
  }),
  http.post('/api/demo/legal/risks/:id/final-review', async ({ params, request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    const body = (await request.json()) as { status: 'approved' | 'rejected' | 'escalated' };
    const item = legalRisks.find((entry) => entry.id === params.id) ?? legalRisks[0];
    return HttpResponse.json({ ...item, status: body.status });
  }),
  http.post('/api/m5/schedule-candidates', async ({ request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    await request.json().catch(() => ({}));
    return HttpResponse.json(
      m5Envelope({
        schedule: { ...scheduleBoard, plan_version: 'current' },
        scenario_purpose: 'pressure_only',
        lifecycle_status: 'draft',
        input_hash: 'a'.repeat(64),
        replayed: false,
      }),
    );
  }),
  http.get('/api/m5/leader/teams', async () =>
    HttpResponse.json(
      m5Envelope([
        {
          team_id: 'team-leader-a1',
          team_code: 'TEAM-A1',
          team_name: '一车间 A 班',
          leader_user_id: 'leader-zhang',
          line_id: 'LINE-A',
          resource_ids: ['EQ-CUT', 'EQ-ASM'],
          shift_rule: { shift: 'day', start: '08:00', end: '17:00' },
          status: 'active',
          created_at: '2026-08-10T00:00:00Z',
          updated_at: '2026-08-10T00:00:00Z',
        },
      ]),
    ),
  ),
  http.post('/api/m5/leader/teams', async ({ request }) => {
    const body = (await request.json()) as {
      team_code: string;
      team_name: string;
      leader_user_id: string;
      resource_ids?: string[];
    };
    return HttpResponse.json(
      m5Envelope({
        team_id: 'team-leader-created',
        team_code: body.team_code,
        team_name: body.team_name,
        leader_user_id: body.leader_user_id,
        resource_ids: body.resource_ids ?? [],
        shift_rule: { shift: 'day' },
        status: 'active',
        created_at: '2026-08-10T00:00:00Z',
        updated_at: '2026-08-10T00:00:00Z',
      }),
    );
  }),
  http.get('/api/m5/leader/teams/:teamId/members', async () =>
    HttpResponse.json(
      m5Envelope([
        {
          id: 'member-1',
          team_id: 'team-leader-a1',
          worker_id: 'worker-wang',
          worker_name: '王师傅',
          station: '押出机 01',
          role: 'worker',
          status: 'active',
          created_at: '2026-08-10T00:00:00Z',
          updated_at: '2026-08-10T00:00:00Z',
        },
        {
          id: 'member-2',
          team_id: 'team-leader-a1',
          worker_id: 'worker-li',
          worker_name: '李师傅',
          station: '焊接工位 02',
          role: 'worker',
          status: 'active',
          created_at: '2026-08-10T00:00:00Z',
          updated_at: '2026-08-10T00:00:00Z',
        },
      ]),
    ),
  ),
  http.post('/api/m5/leader/teams/:teamId/members', async ({ request }) => {
    const body = (await request.json()) as { worker_id: string; worker_name: string; station?: string };
    return HttpResponse.json(
      m5Envelope({
        id: 'member-new',
        team_id: 'team-leader-a1',
        worker_id: body.worker_id,
        worker_name: body.worker_name,
        station: body.station ?? null,
        role: 'worker',
        status: 'active',
        created_at: '2026-08-10T00:00:00Z',
        updated_at: '2026-08-10T00:00:00Z',
      }),
    );
  }),
  http.get('/api/m5/leader/today-tasks', async ({ request }) => {
    const url = new URL(request.url);
    const day = url.searchParams.get('day') ?? '2026-08-10';
    return HttpResponse.json(
      m5Envelope([
        {
          plan_version: 'cp-sat-leader-demo',
          order_id: 'SO-LEADER-001',
          product_id: 'SKU-L',
          order_quantity: 500,
          operation_id: 'OP-10',
          operation_name: '押出',
          resource_id: 'EQ-CUT',
          resource_name: '押出机 01',
          start_time: `${day}T00:00:00Z`,
          end_time: `${day}T02:00:00Z`,
          planned_minutes: 120,
          schedule_status: 'scheduled',
          progress_state: 'running',
          reported_quantity: 240,
          scrap_quantity: 5,
          ledger_entry_count: 2,
        },
        {
          plan_version: 'cp-sat-leader-demo',
          order_id: 'SO-LEADER-001',
          product_id: 'SKU-L',
          order_quantity: 500,
          operation_id: 'OP-20',
          operation_name: '焊接',
          resource_id: 'EQ-ASM',
          resource_name: '焊接工位 02',
          start_time: `${day}T02:00:00Z`,
          end_time: `${day}T04:00:00Z`,
          planned_minutes: 120,
          schedule_status: 'scheduled',
          progress_state: 'not_started',
          reported_quantity: 0,
          scrap_quantity: 0,
          ledger_entry_count: 0,
        },
      ]),
    );
  }),
  http.post('/api/m5/leader/report', async ({ request }) => {
    const body = (await request.json()) as {
      order_id: string;
      operation_id: string;
      worker_id: string;
      event_type: string;
      reported_quantity?: number;
      reported_unit?: string;
      scrap_quantity?: number;
      planned_min?: number;
      actual_min?: number;
    };
    return HttpResponse.json(
      m5Envelope({
        id: `ledger-${Date.now()}`,
        plan_version: 'cp-sat-leader-demo',
        order_id: body.order_id,
        operation_id: body.operation_id,
        operation_name: body.operation_id === 'OP-10' ? '押出' : '焊接',
        resource_id: body.operation_id === 'OP-10' ? 'EQ-CUT' : 'EQ-ASM',
        resource_name: body.operation_id === 'OP-10' ? '押出机 01' : '焊接工位 02',
        product_id: 'SKU-L',
        team_id: 'team-leader-a1',
        team_name: '一车间 A 班',
        leader_user_id: 'leader-zhang',
        worker_id: body.worker_id,
        worker_name: body.worker_id === 'worker-wang' ? '王师傅' : '李师傅',
        station: body.worker_id === 'worker-wang' ? '押出机 01' : '焊接工位 02',
        execution_event_id: `event-${Date.now()}`,
        fact_ref: null,
        planned_min: body.planned_min ?? 120,
        actual_min: body.actual_min ?? null,
        qty_reported: body.reported_quantity ?? 0,
        qty_scrap: body.scrap_quantity ?? 0,
        shift_date: '2026-08-10',
        status:
          body.event_type === 'actual_finish'
            ? 'completed'
            : body.event_type === 'actual_start'
              ? 'running'
              : 'reported',
        params: body.reported_unit ? { reported_unit: body.reported_unit } : {},
        created_at: '2026-08-10T00:00:00Z',
        updated_at: '2026-08-10T00:00:00Z',
      }),
    );
  }),
  http.post('/api/m5/leader/mock-assign', async ({ request }) => {
    const body = (await request.json()) as {
      order_id: string;
      operation_id: string;
      worker_id: string;
      reported_quantity?: number;
      scrap_quantity?: number;
      station?: string;
    };
    return HttpResponse.json(
      m5Envelope({
        id: `ledger-mock-${Date.now()}`,
        plan_version: 'MOCK-PLAN-MSW',
        order_id: body.order_id,
        operation_id: body.operation_id,
        operation_name: body.operation_id === 'OP-50' ? '押出' : '焊接',
        resource_id: body.operation_id === 'OP-50' ? 'WC-50' : 'WC-20',
        resource_name: body.station ?? '模拟工位',
        product_id: 'MOCK-PRODUCT',
        team_id: 'team-leader-a1',
        team_name: '一车间 A 班',
        leader_user_id: 'leader-zhang',
        worker_id: body.worker_id,
        worker_name: body.worker_id === 'worker-wang' ? '王师傅' : '李师傅',
        station: body.station ?? '模拟工位',
        execution_event_id: `event-mock-${Date.now()}`,
        fact_ref: null,
        planned_min: null,
        actual_min: null,
        qty_reported: body.reported_quantity ?? 0,
        qty_scrap: body.scrap_quantity ?? 0,
        shift_date: new Date().toISOString().slice(0, 10),
        status: 'reported',
        params: { source: 'leader-mock-assign' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    );
  }),
  http.get('/api/m5/leader/workload/comparison', async () =>
    HttpResponse.json(
      m5Envelope({
        items: [
          {
            worker_id: 'worker-wang',
            worker_name: '王师傅',
            team_id: 'team-leader-a1',
            order_count: 1,
            operation_count: 3,
            planned_min: 120,
            actual_min: 175,
            variance_min: 55,
            qty_reported: 480,
            qty_scrap: 20,
            completion_rate_percent: 100,
          },
          {
            worker_id: 'worker-li',
            worker_name: '李师傅',
            team_id: 'team-leader-a1',
            order_count: 1,
            operation_count: 2,
            planned_min: 120,
            actual_min: 110,
            variance_min: -10,
            qty_reported: 500,
            qty_scrap: 0,
            completion_rate_percent: 100,
          },
        ],
        total_planned_min: 240,
        total_actual_min: 285,
        total_variance_min: 45,
        total_qty_reported: 980,
        total_qty_scrap: 20,
      }),
    ),
  ),
  http.get('/api/m5/leader/workload', async () =>
    HttpResponse.json(
      m5Envelope({
        items: [
          {
            id: 'ledger-1',
            plan_version: 'cp-sat-leader-demo',
            order_id: 'SO-LEADER-001',
            operation_id: 'OP-10',
            operation_name: '押出',
            resource_id: 'EQ-CUT',
            resource_name: '押出机 01',
            product_id: 'SKU-L',
            team_id: 'team-leader-a1',
            team_name: '一车间 A 班',
            leader_user_id: 'leader-zhang',
            worker_id: 'worker-wang',
            worker_name: '王师傅',
            station: '押出机 01',
            execution_event_id: 'event-1',
            fact_ref: null,
            planned_min: 120,
            actual_min: 90,
            qty_reported: 480,
            qty_scrap: 20,
            shift_date: '2026-08-10',
            status: 'completed',
            params: {},
            created_at: '2026-08-10T00:00:00Z',
            updated_at: '2026-08-10T00:00:00Z',
          },
        ],
        total: 1,
        total_planned_min: 120,
        total_actual_min: 90,
        total_qty_reported: 480,
        total_qty_scrap: 20,
        worker_count: 1,
      }),
    ),
  ),
  http.get('/api/m5/leader/orders/workload', async () =>
    HttpResponse.json(
      m5Envelope({
        items: [
          {
            id: 'ledger-1',
            plan_version: 'cp-sat-leader-demo',
            order_id: 'SO-LEADER-001',
            operation_id: 'OP-10',
            operation_name: '押出',
            resource_id: 'EQ-CUT',
            resource_name: '押出机 01',
            product_id: 'SKU-L',
            team_id: 'team-leader-a1',
            team_name: '一车间 A 班',
            leader_user_id: 'leader-zhang',
            worker_id: 'worker-wang',
            worker_name: '王师傅',
            station: '押出机 01',
            execution_event_id: 'event-1',
            fact_ref: null,
            planned_min: 120,
            actual_min: 90,
            qty_reported: 480,
            qty_scrap: 20,
            shift_date: '2026-08-10',
            status: 'completed',
            params: {},
            created_at: '2026-08-10T00:00:00Z',
            updated_at: '2026-08-10T00:00:00Z',
          },
        ],
        total: 1,
        total_planned_min: 120,
        total_actual_min: 90,
        total_qty_reported: 480,
        total_qty_scrap: 20,
        worker_count: 1,
      }),
    ),
  ),
  http.get('/api/m5/leader/bindings', async ({ request }) => {
    const url = new URL(request.url);
    const orderId = url.searchParams.get('order_id');
    const workerId = url.searchParams.get('worker_id');
    const rows = [
      {
        id: 'binding-1',
        worker_id: 'worker-wang',
        order_id: 'SO-LEADER-001',
        team_id: 'team-leader-a1',
        leader_user_id: 'leader-zhang',
        resource_id: 'EQ-CUT',
        station: '押出机 01',
        role: 'worker',
        status: 'active',
        created_at: '2026-08-10T00:00:00Z',
        updated_at: '2026-08-10T00:00:00Z',
      },
      {
        id: 'binding-2',
        worker_id: 'worker-li',
        order_id: 'SO-LEADER-001',
        team_id: 'team-leader-a1',
        leader_user_id: 'leader-zhang',
        resource_id: 'EQ-ASM',
        station: '焊接工位 02',
        role: 'worker',
        status: 'active',
        created_at: '2026-08-10T00:00:00Z',
        updated_at: '2026-08-10T00:00:00Z',
      },
      {
        id: 'binding-3',
        worker_id: 'worker-zhangsan',
        order_id: 'SO-LEADER-001',
        team_id: 'team-leader-a1',
        leader_user_id: 'leader-zhang',
        resource_id: 'EQ-CUT',
        station: '押出机 01',
        role: 'worker',
        status: 'active',
        created_at: '2026-08-10T00:00:00Z',
        updated_at: '2026-08-10T00:00:00Z',
      },
    ];
    const filtered = rows.filter(
      (row) =>
        (!orderId || row.order_id === orderId) &&
        (!workerId || row.worker_id === workerId),
    );
    return HttpResponse.json(m5Envelope(filtered));
  }),
  http.post('/api/m5/leader/bindings', async ({ request }) => {
    const body = (await request.json()) as { order_id?: string; worker_ids?: string[]; team_id?: string; station?: string };
    const rows = (body.worker_ids ?? []).map((workerId, index) => ({
      id: `binding-new-${Date.now()}-${index}`,
      worker_id: workerId,
      order_id: body.order_id ?? 'SO-LEADER-001',
      team_id: body.team_id ?? 'team-leader-a1',
      leader_user_id: 'leader-zhang',
      resource_id: null,
      station: body.station ?? null,
      role: 'worker',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    return HttpResponse.json(m5Envelope(rows));
  }),
  http.delete('/api/m5/leader/bindings/:bindingId', async ({ params }) =>
    HttpResponse.json(
      m5Envelope({
        id: String(params.bindingId),
        worker_id: 'worker-wang',
        order_id: 'SO-LEADER-001',
        team_id: 'team-leader-a1',
        leader_user_id: 'leader-zhang',
        resource_id: null,
        station: null,
        role: 'worker',
        status: 'closed',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    ),
  ),
  http.get('/api/m5/worker/tasks', async ({ request }) => {
    const url = new URL(request.url);
    const workerId = url.searchParams.get('worker_id');
    if (!workerId || !['worker-wang', 'worker-zhangsan'].includes(workerId)) {
      return HttpResponse.json(m5Envelope([]));
    }
    const common = {
      binding_id: workerId === 'worker-zhangsan' ? 'binding-3' : 'binding-1',
      worker_id: workerId,
      team_id: 'team-leader-a1',
      leader_user_id: 'leader-zhang',
      plan_version: 'cp-sat-leader-demo',
      tracking_task_id: 'task-plan-leader-demo',
      order_id: 'SO-LEADER-001',
      product_id: 'SKU-L',
      unit: 'pcs',
    };
    return HttpResponse.json(m5Envelope([
      {
        ...common,
        station: '押出机 01',
        operation_id: 'OP-10',
        operation_name: '押出',
        resource_id: 'EQ-CUT',
        resource_name: '押出机 01',
        planned_start_time: '2026-08-10T00:00:00Z',
        planned_end_time: '2026-08-10T02:00:00Z',
        actual_status: 'running',
      },
      {
        ...common,
        station: '焊接工位 02',
        operation_id: 'OP-20',
        operation_name: '焊接',
        resource_id: 'EQ-ASM',
        resource_name: '焊接工位 02',
        planned_start_time: '2026-08-10T02:00:00Z',
        planned_end_time: '2026-08-10T04:00:00Z',
        actual_status: 'running',
        unit: null,
      },
    ]));
  }),
  http.post('/api/m5/worker/report', async ({ request }) => {
    const body = (await request.json()) as {
      worker_id?: string;
      plan_version?: string;
      order_id?: string;
      operation_id?: string;
      resource_id?: string;
      event_type?: string;
      reported_quantity?: number;
      reported_unit?: string;
      actual_min?: number;
      idempotency_key?: string;
    };
    if (!body.plan_version || !body.order_id || !body.operation_id || !body.resource_id || !body.idempotency_key) {
      return HttpResponse.json(
        {
          success: false,
          data: null,
          errors: [{ code: 'M5_LEADER_WORKLOAD_INVALID', message: 'worker report requires exact operation identity' }],
          trace_id: 'mock-worker-report-invalid',
        },
        { status: 422 },
      );
    }
    const operation = body.operation_id === 'OP-20'
      ? { operation_name: '焊接', resource_name: '焊接工位 02' }
      : { operation_name: '押出', resource_name: '押出机 01' };
    return HttpResponse.json(
      m5Envelope({
        id: `ledger-worker-${Date.now()}`,
        plan_version: body.plan_version,
        order_id: body.order_id,
        operation_id: body.operation_id,
        operation_name: operation.operation_name,
        resource_id: body.resource_id,
        resource_name: operation.resource_name,
        team_id: 'team-leader-a1',
        team_name: '一车间 A 班',
        leader_user_id: 'leader-zhang',
        worker_id: body.worker_id ?? 'worker-wang',
        worker_name: '王师傅',
        station: operation.resource_name,
        execution_event_id: `event-worker-${Date.now()}`,
        fact_ref: null,
        planned_min: 120,
        actual_min: body.actual_min ?? null,
        qty_reported: body.reported_quantity ?? 0,
        qty_scrap: 0,
        shift_date: new Date().toISOString().slice(0, 10),
        status: body.event_type === 'actual_finish' ? 'completed' : 'reported',
        params: { source: 'worker-section', reported_unit: body.reported_unit },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    );
  }),
  http.get('/api/m5/worker/order-operations', async ({ request }) => {
    const url = new URL(request.url);
    const orderId = url.searchParams.get('order_id') ?? 'SO-LEADER-001';
    return HttpResponse.json(
      m5Envelope({
        order_id: orderId,
        count: 2,
        items: [
          {
            order_id: orderId,
            operation_id: 'OP-10',
            operation_name: '押出',
            resource_id: 'EQ-CUT',
            plan_version: 'cp-sat-leader-demo',
            start_time: '2026-08-10T00:00:00Z',
          },
          {
            order_id: orderId,
            operation_id: 'OP-20',
            operation_name: '绞线',
            resource_id: 'EQ-TWIST',
            plan_version: 'cp-sat-leader-demo',
            start_time: '2026-08-10T02:00:00Z',
          },
        ],
      }),
    );
  }),
  http.get('/api/m5/piece-wage/rates', async () =>
    HttpResponse.json(m5Envelope({ items: [], count: 0 })),
  ),
  http.get('/api/m5/piece-wage/daily', async () =>
    HttpResponse.json(
      m5Envelope({
        shift_date: new Date().toISOString().slice(0, 10),
        total: 0,
        line_count: 0,
        lines: [],
        summary_by_worker: [],
        summary_by_order: [],
        summary_by_station: [],
        missing_rate: [],
      }),
    ),
  ),
  http.get('/api/m5/schedules', async () => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json(m5Envelope(scenario === 'empty' ? [] : [{ plan_version: 'current' }]));
  }),
  http.post('/api/m5/schedules', async ({ request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    await request.json().catch(() => ({}));
    return HttpResponse.json(m5Envelope({ ...scheduleBoard, plan_version: 'current' }), { status: 201 });
  }),
  http.get('/api/m5/schedules/current', async () => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json(m5Envelope(scenario === 'empty' ? emptyScheduleBoard : scheduleBoard));
  }),
  http.get('/api/m5/schedules/:planVersion', async ({ params }) => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json(m5Envelope(scenario === 'empty' ? emptyScheduleBoard : { ...scheduleBoard, plan_version: String(params.planVersion) }));
  }),
  http.get('/api/m5/schedules/current/dependencies', async () => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json(m5Envelope(scenario === 'empty' ? [] : scheduleDependencies));
  }),
  http.get('/api/m5/schedules/:planVersion/dependencies', async () => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json(m5Envelope(scenario === 'empty' ? [] : scheduleDependencies));
  }),
  http.patch('/api/m5/schedules/current/operations/:orderId/:operationId', async ({ params, request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    await request.json().catch(() => ({}));
    const task = scheduleBoard.tasks.find((entry) => entry.id === params.operationId) ?? scheduleBoard.tasks[0];
    return HttpResponse.json(m5Envelope({ ...task, status: 'adjusted' }));
  }),
  http.patch('/api/m5/schedules/:planVersion/operations/:orderId/:operationId', async ({ params, request }) => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    await request.json().catch(() => ({}));
    const task = scheduleBoard.tasks.find((entry) => entry.id === params.operationId) ?? scheduleBoard.tasks[0];
    return HttpResponse.json(m5Envelope({ ...task, status: 'adjusted' }));
  }),
  http.post('/api/m5/schedules/:planVersion/operations/:orderId/:operationId/lock', async ({ params, request }) => {
    await request.json().catch(() => ({}));
    const task = scheduleBoard.tasks.find((entry) => entry.id === params.operationId) ?? scheduleBoard.tasks[0];
    return HttpResponse.json(m5Envelope({ ...task, locked: true }));
  }),
  http.post('/api/m5/schedules/:planVersion/operations/:orderId/:operationId/unlock', async ({ params, request }) => {
    await request.json().catch(() => ({}));
    const task = scheduleBoard.tasks.find((entry) => entry.id === params.operationId) ?? scheduleBoard.tasks[0];
    return HttpResponse.json(m5Envelope({ ...task, locked: false }));
  }),
  http.post('/api/m5/schedules/intelligent', async () => HttpResponse.json(m5Envelope({ ...scheduleBoard, plan_version: 'current' }))),
  http.post('/api/m5/schedules/:planVersion/dispatch', async ({ params, request }) => {
    await request.json().catch(() => ({}));
    return HttpResponse.json(m5Envelope({ plan_version: String(params.planVersion), status: 'dispatched' }));
  }),
  http.post('/api/m5/schedules/:planVersion/execution-events', async ({ params, request }) => {
    await request.json().catch(() => ({}));
    return HttpResponse.json(m5Envelope({ plan_version: String(params.planVersion), event_id: 'M5-EVT-001', accepted: true }));
  }),
  http.get('/api/m5/schedules/:planVersion/execution-summary', async ({ params }) =>
    HttpResponse.json(
      m5Envelope({
        plan_version: String(params.planVersion),
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
      }),
    ),
  ),
  http.get('/api/m5/pmc/progress', async ({ request }) => {
    const planVersion = new URL(request.url).searchParams.get('plan_version') ?? 'current';
    return HttpResponse.json(m5Envelope({
      plan_version: planVersion,
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
        order_id: 'SO-PMC-001',
        product_id: 'HDMI-2M',
        planned_quantity: 100,
        unit: 'pcs',
        due_time: '2026-08-21T10:00:00Z',
        actual_qty: 35,
        actual_quantity_supported: true,
        terminal_operation_id: 'OP-10',
        completion_rate_percent: 35,
        status: 'wip',
        on_time: null,
        planned_completion_time: '2026-08-20T09:00:00Z',
        actual_completion_time: null,
        operations: [{
          order_id: 'SO-PMC-001',
          product_id: 'HDMI-2M',
          operation_id: 'OP-10',
          operation_name: '裁线',
          resource_id: 'WC-1',
          planned_start_time: '2026-08-20T08:00:00Z',
          planned_end_time: '2026-08-20T09:00:00Z',
          planned_quantity: 100,
          unit: 'pcs',
          actual_start_time: '2026-08-20T07:50:00Z',
          actual_end_time: null,
          actual_qty: 35,
          actual_status: 'running',
          completion_rate_percent: 35,
        }],
      }],
    }));
  }),
  http.post('/api/m5/schedules/jobs', async () => HttpResponse.json(m5Envelope({ job_id: 'm5-job-001', status: 'queued' }))),
  http.get('/api/m5/ops/jobs/:jobId', async ({ params }) => HttpResponse.json(m5Envelope({ job_id: String(params.jobId), status: 'done' }))),
  http.get('/api/m5/ops/flow-dashboard', async ({ request }) => {
    const { scenario, response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    if (scenario === 'empty') {
      return HttpResponse.json(m5Envelope([]));
    }
    const query = new URL(request.url).searchParams;
    const trackingTaskId = query.get('tracking_task_id');
    const planVersion = query.get('plan_version');
    const limit = toNumberParam(query.get('limit'), 20);
    return HttpResponse.json(
      m5Envelope(
        initialM5FlowDashboard
          .filter((item) => !trackingTaskId || item.tracking_task_id === trackingTaskId)
          .filter((item) => !planVersion || item.plan_version === planVersion)
          .slice(0, limit),
      ),
    );
  }),
  http.get('/api/m5/integrations/snapshots/:scenarioId/readiness', async () => HttpResponse.json(m5Envelope({ scenario_id: 'scenario-001', items: [] }))),
  http.post('/api/m5/materials/procurement-plan', async () => HttpResponse.json(m5Envelope({ plan_id: 'mat-plan-001' }))),
  http.get('/api/m0/parser-compat/health', async () => HttpResponse.json({ status: 'ok' })),
  http.get('/api/m2/health', async () => HttpResponse.json({ status: 'ok' })),
  http.get('/api/m3/health', async () => HttpResponse.json({ status: 'ok' })),
  http.get('/api/m4/health', async () => HttpResponse.json({ status: 'ok' })),
  http.get('/api/m5/health', async () => HttpResponse.json({ status: 'ok' })),
  http.post('/api/m0/import/upload', async () => {
    const { response } = await guardedScenario(getScenario);
    if (response) {
      return response;
    }
    return HttpResponse.json(
      {
        success: true,
        data: {
          id: `M0-BATCH-${uuid6().slice(0, 8)}`,
          status: 'awaiting_review',
          source_names: 'mock-files',
          stats: {},
          tenant_id: 'mock-tenant',
          created_by: 'mock',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        errors: [],
        trace_id: 'msw-m0-trace',
      },
      { status: 202 },
    );
  }),
  http.get('/api/m0/import/batch/:batchId/documents/:documentId/preview.html', () =>
    new HttpResponse(bomPreviewHtml, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }),
  ),
  http.get('/api/m0/import/batches', async () =>
    HttpResponse.json({
      success: true,
      data: {
        batches: [
          { id: 'M0-BATCH-001', status: 'committed', source_names: 'bom.csv', stats: {}, tenant_id: 'mock-tenant', created_by: 'mock', created_at: '2026-08-10T00:00:00Z', updated_at: '2026-08-10T00:00:00Z' },
        ],
      },
      errors: [],
      trace_id: 'msw-m0-trace',
    }),
  ),
  http.get('/api/m0/import/batch/:batchId', async () =>
    HttpResponse.json({
      success: true,
      data: {
        batch: { id: 'M0-BATCH-001', status: 'committed', source_names: 'bom.csv', stats: {}, tenant_id: 'mock-tenant', created_by: 'mock', created_at: '2026-08-10T00:00:00Z', updated_at: '2026-08-10T00:00:00Z' },
        documents: m0ExtractDocuments,
        stats: {},
      },
      errors: [],
      trace_id: 'msw-m0-trace',
    }),
  ),
  http.post('/api/m0/import/batch/:batchId/extract/retry', async () =>
    HttpResponse.json({
      success: true,
      data: { batch_id: 'M0-BATCH-001', retried: 1, document_ids: [7] },
      errors: [],
      trace_id: 'msw-m0-trace',
    }),
  ),
  http.get('/api/m0/import/batch/:batchId/preview', async () =>
    HttpResponse.json({
      success: true,
      data: {
        batch: { id: 'M0-BATCH-001', status: 'committed', source_names: 'bom.csv', stats: {}, tenant_id: 'mock-tenant', created_by: 'mock', created_at: '2026-08-10T00:00:00Z', updated_at: '2026-08-10T00:00:00Z' },
        documents: m0ExtractDocuments,
        rows: [],
        entities: [],
        mappings: [],
        quarantine: [],
        ledger: [],
      },
      errors: [],
      trace_id: 'msw-m0-trace',
    }),
  ),
  http.post('/api/m0/import/batch/:batchId/commit', async () =>
    HttpResponse.json({ success: true, data: { batch_id: 'M0-BATCH-001', status: 'committed', master_counts: {} }, errors: [], trace_id: 'msw-m0-trace' }),
  ),
  http.post('/api/m0/import/batch/:batchId/rollback', async () =>
    HttpResponse.json({ success: true, data: { batch_id: 'M0-BATCH-001', status: 'rolled_back' }, errors: [], trace_id: 'msw-m0-trace' }),
  ),
  http.get('/api/m0/import/master/:table', async ({ params }) => {
    const table = String(params.table);
    const items =
      table === 'm0_master_machine'
        ? [
            { id: 11, batch_id: 'M0-BATCH-001', machine_code: 'M-001', machine_name: '注塑机', machine_type: '注塑', line: 'A线', status: 'active', params_json: '{}', code_source: 'customer', created_at: '2026-08-10T00:00:00Z' },
            { id: 12, batch_id: 'M0-BATCH-001', machine_code: 'M-002', machine_name: 'CNC', machine_type: '加工', line: 'B线', status: 'active', params_json: '{}', code_source: 'customer', created_at: '2026-08-10T00:00:00Z' },
          ]
        : [];
    return HttpResponse.json({
      success: true,
      data: { items },
      errors: [],
      trace_id: 'msw-m0-trace',
    });
  }),
  http.post('/api/m0/import/master/:table', async ({ params }) => {
    const table = String(params.table);
    return HttpResponse.json({
      success: true,
      data: { row: { id: 999, table, batch_id: 'manual' }, id: 999 },
      errors: [],
      trace_id: 'msw-m0-trace',
    });
  }),
  http.get('/api/m0/documents', async () =>
    HttpResponse.json({
      success: true,
      data: {
        documents: [
          {
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
            bindings: [
              {
                id: 11,
                doc_id: 1,
                entity_type: 'material',
                entity_id: 'CABLE-2M',
                entity_code: 'CABLE-2M',
                entity_name: 'HDMI 线材 2M',
                stage: '押出',
                created_by: 'mock',
                created_at: '2026-08-10T00:00:00Z',
              },
            ],
          },
        ],
      },
      errors: [],
      trace_id: 'msw-m0-trace',
    }),
  ),
  http.post('/api/m0/documents/:docId/bindings', async ({ params, request }) => {
    const body = (await request.json()) as { bindings?: Array<{ entity_type: string; entity_id: string; stage?: string }> };
    const bindings = (body.bindings ?? []).map((binding, index) => ({
      id: 100 + index,
      doc_id: Number(params.docId),
      entity_type: binding.entity_type,
      entity_id: binding.entity_id,
      entity_code: binding.entity_id,
      entity_name: '',
      stage: binding.stage ?? '',
      created_by: 'mock',
      created_at: new Date().toISOString(),
    }));
    return HttpResponse.json({ success: true, data: { bindings }, errors: [], trace_id: 'msw-m0-trace' });
  }),
  http.get('/api/m0/documents/:docId/bindings', async ({ params }) =>
    HttpResponse.json({
      success: true,
      data: {
        document: { id: Number(params.docId), batch_id: 'M0-BATCH-001', domain: 'drawing', doc_type: 'engineering_drawing', doc_no: '', title: '图纸_承认书_ABC-123.pdf', content_text: '', stored_name: 'mock-drawing.pdf', status: 'approved', created_at: '2026-08-10T00:00:00Z' },
        bindings: [
          {
            id: 11,
            doc_id: Number(params.docId),
            entity_type: 'material',
            entity_id: 'CABLE-2M',
            entity_code: 'CABLE-2M',
            entity_name: 'HDMI 线材 2M',
            stage: '押出',
            created_by: 'mock',
            created_at: '2026-08-10T00:00:00Z',
          },
        ],
      },
      errors: [],
      trace_id: 'msw-m0-trace',
    }),
  ),
  http.delete('/api/m0/documents/bindings/:bindingId', async ({ params }) =>
    HttpResponse.json({ success: true, data: { deleted: Number(params.bindingId) }, errors: [], trace_id: 'msw-m0-trace' }),
  ),
  http.post('/api/m0/documents/:docId/doc_type', async ({ params, request }) => {
    const body = (await request.json()) as { doc_type?: string };
    return HttpResponse.json({
      success: true,
      data: {
        document: { id: Number(params.docId), batch_id: 'M0-BATCH-001', domain: 'drawing', doc_type: body.doc_type ?? '', doc_no: '', title: '图纸_承认书_ABC-123.pdf', content_text: '', stored_name: 'mock-drawing.pdf', status: 'approved', created_at: '2026-08-10T00:00:00Z' },
      },
      errors: [],
      trace_id: 'msw-m0-trace',
    });
  }),
  http.get('/api/m0/documents/:docId/file', () =>
    HttpResponse.arrayBuffer(new TextEncoder().encode('%PDF-1.4 mock').buffer, {
      headers: { 'Content-Type': 'application/pdf' },
    }),
  ),
  http.post('/api/m2/run', async () => HttpResponse.json({ result: m2WorkflowResult })),
  http.get('/api/m2/artifact', async ({ request }) => {
    const path = new URL(request.url).searchParams.get('path') ?? '';
    return path.endsWith('parsed_sop.json')
      ? HttpResponse.json(m2ParsedSop)
      : HttpResponse.arrayBuffer(new TextEncoder().encode('artifact').buffer, { headers: { 'Content-Type': 'application/octet-stream' } });
  }),
  http.post('/api/m2/bom/history/search', async () => HttpResponse.json({ items: bomItems })),
  http.post('/api/m2/bom/generate-controlled', async () => HttpResponse.json({ bom_id: 'BOM-CONTROLLED-001' })),
  http.post('/api/m2/bom/templates/onboard', async () => HttpResponse.json({ template_id: 'TPL-001' })),
  http.post('/api/m2/sop/generate', async () => HttpResponse.json({ sop_id: 'SOP-001' })),
  http.get('/api/m3/orders', async () => HttpResponse.json({ success: true, data: [{ order_id: 'ORD-001' }], errors: [] })),
  http.get('/api/m3/orders/:orderId', async ({ params }) => HttpResponse.json({ success: true, data: { order_id: String(params.orderId) }, errors: [] })),
  http.post(/\/api\/m3\/procurement-requirements:run-json$/, async () =>
    HttpResponse.json({ success: true, data: { plan_id: 'PLAN-001' }, errors: [] }),
  ),
  http.post(/\/api\/m3\/procurement-plan:run-json$/, async () =>
    HttpResponse.json({ success: true, data: { plan_id: 'PLAN-001' }, errors: [] }),
  ),
  http.post(/\/api\/m3\/procurement-plan:run$/, async () =>
    HttpResponse.json({
      success: true,
      data: { procurement_plan_id: 'PLAN-001', order_id: 'ORD-001', lines: [] },
      approval_tasks: [],
      errors: [],
    }),
  ),
  http.get('/api/m3/procurement-plan', async () => HttpResponse.json({ success: true, data: { plan_id: 'PLAN-001' }, errors: [] })),
  http.get('/api/m3/procurement-plan/:planId', async ({ params }) =>
    HttpResponse.json({ success: true, data: { plan_id: String(params.planId) }, errors: [] }),
  ),
  http.get('/api/m3/approval-tasks', async () => HttpResponse.json({ success: true, data: [{ task_id: 'APP-001', status: 'pending' }], errors: [] })),
  http.post(/\/api\/m3\/approval-tasks\/([^/]+):approve$/, async () =>
    HttpResponse.json({ success: true, data: { task_id: 'APP-001', status: 'approved' }, errors: [] }),
  ),
  http.post(/\/api\/m3\/approval-tasks\/([^/]+):reject$/, async () =>
    HttpResponse.json({ success: true, data: { task_id: 'APP-001', status: 'rejected' }, errors: [] }),
  ),
  http.post(/\/api\/m3\/approval-tasks\/([^/]+):request-change$/, async () =>
    HttpResponse.json({ success: true, data: { task_id: 'APP-001', status: 'change_requested' }, errors: [] }),
  ),
  http.post(/\/api\/m3\/approval-tasks\/([^/]+):approve_to_send$/, async () =>
    HttpResponse.json({ success: true, data: { task_id: 'APP-001', status: 'approved_to_send' }, errors: [] }),
  ),
  http.get('/api/m3/material-readiness', async () =>
    HttpResponse.json({
      success: true,
      data: {
        material_ready_status: 'shortage_with_procurement_plan',
        pmc_release_recommendation: 'allow_draft_schedule_only',
        lines: [
          {
            material_code: 'MAT-001',
            material_name: '轴承',
            uom: 'PCS',
            gross_required_qty: 120,
            available_qty: 40,
            open_po_qty: 30,
            shortage_qty: 50,
            suggest_purchase_qty: 50,
            line_status: 'shortage',
            expected_available_date: '2026-08-12',
            urgent: true,
          },
          {
            material_code: 'MAT-003',
            material_name: '联轴器',
            uom: 'SET',
            gross_required_qty: 24,
            available_qty: 6,
            open_po_qty: 0,
            shortage_qty: 18,
            suggest_purchase_qty: 18,
            line_status: 'shortage',
          },
          {
            material_code: 'MAT-002',
            material_name: '传感器',
            uom: 'PCS',
            gross_required_qty: 60,
            available_qty: 60,
            open_po_qty: 0,
            shortage_qty: 0,
            suggest_purchase_qty: 0,
            line_status: 'ready',
          },
          {
            material_code: 'MAT-005',
            material_name: '结构件支架',
            uom: 'PCS',
            gross_required_qty: 80,
            available_qty: 60,
            open_po_qty: 0,
            shortage_qty: 20,
            suggest_purchase_qty: 20,
            line_status: 'shortage',
            expected_available_date: null,
            urgent: false,
          },
        ],
      },
      errors: [],
    }),
  ),
  http.get('/api/m3/persisted/procurement-plans', async () =>
    HttpResponse.json({
      success: true,
      data: {
        total: 1,
        page: 1,
        page_size: 50,
        items: [
          {
            procurement_plan_id: 'PLAN-001',
            order_id: 'ORD-001',
            project_id: 'PRJ-001',
            bom_id: 'BOM-001',
            plan_version: 'v1',
            status: 'ready_for_m4',
            availability_status: 'partial_shortage',
            line_count: 7,
            shortage_count: 2,
            trace_id: 'trace-m3-persisted',
            source_type: 'test',
            created_at: '2026-08-09T00:00:00Z',
          },
        ],
      },
      errors: [],
    }),
  ),
  http.get('/api/m3/pr-po-drafts', async () =>
    HttpResponse.json({
      success: true,
      data: {
        status: 'blocked_by_procurement_approval',
        release_gate: 'procurement_plan_approval',
        purchase_requisition_draft: {
          draft_id: 'PR-DRAFT-001',
          status: 'blocked_by_procurement_approval',
          lines: [],
        },
        purchase_order_drafts: [],
      },
      errors: [],
    }),
  ),
  http.post('/api/m3/procurement-plan/:planId/handoff-to-m4', async ({ params }) =>
    HttpResponse.json({ success: true, data: { plan_id: String(params.planId), handed_off: true }, errors: [] }),
  ),
  http.get('/api/m3/procurement-plan/:planId/export-suggestions', async () =>
    HttpResponse.json({ success: true, data: { plan_id: 'PLAN-001', suggestions: [], count: 0 }, errors: [] }),
  ),
  http.get('/api/m6/health', async () => HttpResponse.json({ success: true, data: { status: 'ok' }, errors: [] })),
  http.post('/api/m6/finance/cost', async () => HttpResponse.json({ success: true, data: { total_cost: '12800.00' }, errors: [] })),
  http.post('/api/m6/finance/bom/import', async () => HttpResponse.json({ success: true, data: { import_id: 'M6-IMP-001', status: 'accepted' }, errors: [] })),
  http.get('/api/m8/health', async () => HttpResponse.json({ status: 'ok' })),
  http.post('/api/m8/projects', async () => HttpResponse.json({ project_id: 'M8-PROJ-001', status: 'created' }, { status: 201 })),
  http.get('/api/m8/projects/:projectId', async ({ params }) => HttpResponse.json({ project_id: String(params.projectId), status: 'active' })),
  http.post('/api/m8/projects/:projectId/messages', async () => HttpResponse.json({ run_id: 'M8-RUN-001', status: 'running' })),
  http.get('/api/m8/projects/:projectId/runs/:runId', async ({ params }) => HttpResponse.json({ run_id: String(params.runId), status: 'done' })),
  http.post('/api/m8/projects/:projectId/human-decisions', async () => HttpResponse.json({ accepted: true })),
  http.get('/api/m8/projects/:projectId/outputs/:key', async ({ params }) => {
    const key = String(params.key);
    return key.endsWith('.txt')
      ? HttpResponse.text('mock output', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
      : HttpResponse.json({ key, value: 'mock output' });
  }),
  http.get('/api/m8/projects/:projectId/assets/:key', async () =>
    HttpResponse.arrayBuffer(new TextEncoder().encode('asset').buffer, { headers: { 'Content-Type': 'application/octet-stream' } }),
  ),
  http.get('/api/m8/cad-drawing-agent/contract', async () => HttpResponse.json({ version: 'mock-contract-v1' })),
  http.post('/api/m8/projects/:projectId/cad-drawing-requests', async () =>
    HttpResponse.json({ request_id: 'CAD-REQ-001', status: 'not_implemented' }, { status: 501 }),
  ),
];

export const handlers = createHandlers();
