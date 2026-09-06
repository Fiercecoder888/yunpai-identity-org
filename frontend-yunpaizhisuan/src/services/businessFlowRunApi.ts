import { z } from 'zod';
import { requestJson } from './httpClient';
import { sha256Hex } from './sha256';

export type BusinessFlowRunInput = {
  catalogId: string;
  orderId: string;
  productName: string;
  orderType?: 'normal' | 'pre_order' | 'sample';
  orderFile?: Blob;
  orderFilename?: string;
  mode?: 'real' | 'pressure_only';
  orderNumber?: string;
  m2Input?: Record<string, unknown>;
  m3InputUrl?: string;
  m3Input?: Record<string, unknown>;
  m4Input?: Record<string, unknown>;
  m4GenerateInput?: Record<string, unknown>;
  m5Input?: Record<string, unknown>;
  productCode?: string;
  orderQty?: number;
  unit?: string;
  dueDate?: string;
  historyBomPath?: string;
};

export type BusinessFlowRunProgress = {
  phase:
    | 'submitting'
    | 'm1_m2'
    | 'm3_m4'
    | 'm5'
    | 'human_input_required'
    | 'blocked'
    | 'data_incomplete'
    | 'done'
    | 'failed';
  title: string;
  detail: string;
  trackingTaskId?: string;
  runId?: string;
  trace?: BusinessOrderTrace;
  run?: BusinessFlowRun;
  failed?: boolean;
  error?: string;
  missing?: Array<Record<string, unknown>>;
  // 人工门缺的基础资料清单：后端 gate 返回 missing_documents
  // [{module, file_type, file_type_hint, reason}]，前端据此提示「缺什么文件」。
  missingDocuments?: Array<Record<string, unknown>>;
  gate?: BusinessFlowGate;
};

export type BusinessFlowGate = {
  gateCode: string;
  gateKind: 'exception' | 'data_missing';
  severity: 'warning' | 'critical';
  title: string;
  defaultAction: 'allow' | 'reject' | 'pause_modify';
  allowedActions: Array<'allow' | 'reject' | 'pause_modify'>;
  evidenceSummary: string;
  evidenceDigest: string;
};

export type BusinessFlowResumeAction =
  | 'continue'
  | 'approve_bom_for_m0_publication'
  | 'confirm_simulated_procurement_received'
  | 'allow'
  | 'reject'
  | 'pause_modify';

export type BusinessFlowResumeCommand = {
  action?: BusinessFlowResumeAction;
  gateCode?: string;
  evidenceDigest?: string;
  supplement?: Record<string, unknown>;
  comment?: string;
};

export type BusinessFlowCreateRequest = {
  idempotency_key: string;
  order_id: string;
  order_number?: string;
  mode: 'real' | 'pressure_only';
  order_type: 'normal' | 'pre_order' | 'sample';
  order_file?: {
    filename: string;
    content_type: string;
    content_b64: string;
  };
  m1_options: Record<string, unknown>;
  m2_payload: Record<string, unknown> | null;
  m3_payload: Record<string, unknown> | null;
  m4_payload: Record<string, unknown>;
  m4_generate_payload: Record<string, unknown> | null;
  m5_payload: Record<string, unknown> | null;
  replace_m3_bom_with_m2: boolean;
  session_id: string;
};

export type BusinessCatalogRunConfig = {
  catalog_id: string;
  order_url: string;
  order_filename: string;
  m3_input_url: string;
  product_code?: string;
  history_bom_path?: string;
  mode?: 'real' | 'pressure_only';
  m4_payload?: Record<string, unknown>;
  m4_generate_payload?: Record<string, unknown>;
  m5_payload?: Record<string, unknown> | null;
  order?: {
    order_id: string;
    order_number?: string;
    product_name?: string;
    order_qty?: number;
    unit?: string;
    due_date?: string;
    bom_excel_path?: string;
  };
};

const flowStatusSchema = z.enum([
  'queued',
  'running',
  'human_input_required',
  'blocked',
  'data_incomplete',
  'completed',
  'failed',
  'cancelled',
]);

export const businessFlowCreatedSchema = z.object({
  run_id: z.string().min(1),
  tracking_task_id: z.string().min(1),
  order_id: z.string().min(1),
  mode: z.enum(['real', 'pressure_only']),
  order_type: z.enum(['normal', 'pre_order', 'sample']).optional(),
  flow_kind: z.enum(['main', 'sample']).optional(),
  status: flowStatusSchema,
  current_node: z.string().min(1),
});

const businessFlowRunSchema = z
  .object({
    run_id: z.string().min(1),
    tracking_task_id: z.string().min(1),
    requested_order_id: z.string().optional(),
    order_id: z.string().nullable().optional(),
    mode: z.enum(['real', 'pressure_only']),
    order_type: z.enum(['normal', 'pre_order', 'sample']).optional(),
    flow_kind: z.enum(['main', 'sample']).optional(),
    status: flowStatusSchema,
    current_node: z.string().min(1),
    error: z.record(z.unknown()).nullable().optional(),
    blocked_reason: z.record(z.unknown()).nullable().optional(),
    result_summary: z.record(z.unknown()).optional(),
    results: z.record(z.unknown()).optional(),
    steps: z.array(z.record(z.unknown())).default([]),
  })
  .passthrough();

const businessOrderTraceSchema = z
  .object({
    tenant_id: z.string(),
    order_id: z.string(),
    order: z.record(z.unknown()).nullable(),
    materials: z.array(z.record(z.unknown())),
    order_materials: z.array(z.record(z.unknown())).default([]),
    inventory_balances: z.array(z.record(z.unknown())),
    inventory_movements: z.array(z.record(z.unknown())),
    procurement_plans: z.array(z.record(z.unknown())),
    procurement_plan_lines: z.array(z.record(z.unknown())),
    purchase_orders: z.array(z.record(z.unknown())),
    schedule_versions: z.array(z.record(z.unknown())),
    business_flow_runs: z.array(z.record(z.unknown())),
    fact_versions: z.array(z.record(z.unknown())).default([]),
    calculation_runs: z.array(z.record(z.unknown())).default([]),
    validation_results: z.array(z.record(z.unknown())).default([]),
    supply_allocations: z.array(z.record(z.unknown())).default([]),
    recalculation_jobs: z.array(z.record(z.unknown())).default([]),
  })
  .passthrough();

const businessTaskTraceSchema = z.object({
  flow: businessFlowRunSchema,
  trace: businessOrderTraceSchema,
});

export type BusinessFlowCreated = z.infer<typeof businessFlowCreatedSchema>;
export type BusinessFlowRun = z.infer<typeof businessFlowRunSchema>;
export type BusinessOrderTrace = z.infer<typeof businessOrderTraceSchema>;
export type BusinessTaskTrace = z.infer<typeof businessTaskTraceSchema>;

const latestScheduleForTask = (
  trace: BusinessOrderTrace | undefined,
  trackingTaskId: string,
) => [...(trace?.schedule_versions ?? [])]
  .reverse()
  .find((schedule) => String(schedule.tracking_task_id ?? '') === trackingTaskId);

/**
 * 归一化 run 返回体：编排器「进程内热缓存」返回顶层 results / blocked_reason，
 * 而「冷启动后读 Postgres」返回 execution_state.results / error（blocked_reason 被合并进
 * error）。统一成前者，让缺料/匹配复核/BOM 审批等人工门卡片在两条路径上都能读到具体明细。
 */
function normalizeRun(raw: BusinessFlowRun): BusinessFlowRun {
  const run = { ...raw };
  const executionState = (run as Record<string, unknown>).execution_state;
  if (
    run.results == null &&
    executionState &&
    typeof executionState === 'object' &&
    !Array.isArray(executionState)
  ) {
    const nestedResults = (executionState as Record<string, unknown>).results;
    if (nestedResults && typeof nestedResults === 'object') {
      run.results = nestedResults as BusinessFlowRun['results'];
    }
  }
  const error = run.error;
  if (
    run.blocked_reason == null &&
    error &&
    typeof error === 'object' &&
    !Array.isArray(error)
  ) {
    const code = String((error as Record<string, unknown>).code ?? '');
    if (code === 'MISSING_AUTHORITY_FACTS' || code === 'HUMAN_INPUT_REQUIRED') {
      run.blocked_reason = error;
    }
  }
  return run;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const readBlobBytes = async (blob: Blob) => {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('订单文件读取失败'));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('订单文件读取结果无效'));
      }
    };
    reader.readAsArrayBuffer(blob);
  });
  return new Uint8Array(buffer);
};

const encodeFile = async (blob: Blob) => {
  const bytes = await readBlobBytes(blob);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  const digestHex = await sha256Hex(bytes);
  return { contentB64: btoa(binary), digestHex };
};

const createBusinessRunIdentity = async (scope: string, contentDigest: string) => {
  const nonce = new Uint8Array(16);
  globalThis.crypto.getRandomValues(nonce);
  const nonceHex = Array.from(nonce, (value) => value.toString(16).padStart(2, '0')).join('');
  const taskDigest = await sha256Hex(`${scope}:${contentDigest}:${nonceHex}`);
  return {
    trackingTaskId: `task_${taskDigest.slice(0, 32)}`,
    idempotencyKey: `business:${scope}:${contentDigest}:run:${nonceHex}`.slice(0, 256),
  };
};

const defaultM2Payload = (input: BusinessFlowRunInput): Record<string, unknown> => ({
  product_profile: {
    product_name: input.productName,
    product_code: input.productCode ?? '',
  },
  order_qty: input.orderQty,
  requirement_text: `订单 ${input.orderId}，数量 ${input.orderQty ?? '待确认'} ${input.unit ?? ''}，交期 ${input.dueDate ?? '待确认'}。仅使用已提供的历史 BOM 和证据；缺失事实时请求人工补充。`,
  rule_package_path: '/app/m2_bom_sop_agent/bom',
  use_demo_sources: false,
  history_bom_paths: input.historyBomPath ? [input.historyBomPath] : [],
  template_confirmation: { confirmed: true },
  customer_answers: { manual_message: '' },
  enable_bom_model: false,
  enable_sop_model: false,
});

const readBusinessFlowGate = (reason: Record<string, unknown> | null | undefined): BusinessFlowGate | undefined => {
  if (!reason) return undefined;
  const gateCode = String(reason.gate_code ?? '');
  const evidenceDigest = String(reason.evidence_digest ?? '');
  const gateKind = reason.gate_kind;
  if (!gateCode || !evidenceDigest || (gateKind !== 'exception' && gateKind !== 'data_missing')) return undefined;
  const allowed = Array.isArray(reason.allowed_actions)
    ? reason.allowed_actions.filter(
        (action): action is 'allow' | 'reject' | 'pause_modify' =>
          action === 'allow' || action === 'reject' || action === 'pause_modify',
      )
    : [];
  const defaultAction = reason.default_action;
  return {
    gateCode,
    gateKind,
    severity: reason.severity === 'critical' ? 'critical' : 'warning',
    title: String(reason.title ?? '需要人工决策'),
    defaultAction:
      defaultAction === 'reject' || defaultAction === 'pause_modify' ? defaultAction : 'allow',
    allowedActions: allowed,
    evidenceSummary: String(reason.evidence_summary ?? reason.message ?? ''),
    evidenceDigest,
  };
};

export const businessFlowRunProgress = (
  run: BusinessFlowRun,
  trace?: BusinessOrderTrace,
): BusinessFlowRunProgress => {
  const base = {
    trackingTaskId: run.tracking_task_id,
    runId: run.run_id,
    trace,
    run,
  };
  const isSampleFlow = run.flow_kind === 'sample';
  const gate = readBusinessFlowGate(run.blocked_reason ?? run.error);
  // 人工门缺的基础资料：gate 顶层 missing_documents（_gated/_blocked 返回）优先，
  // 兜底从 blocked_reason 内嵌读取（旧路径兼容）。
  const missingDocuments = (run as Record<string, unknown>).missing_documents as
    | Array<Record<string, unknown>>
    | undefined
    ?? (run.blocked_reason?.missing_documents as Array<Record<string, unknown>> | undefined);
  if (run.status === 'human_input_required') {
    const reason = String(
      run.blocked_reason?.message ??
        run.error?.message ??
        '缺少继续执行所需的已审核业务事实',
    );
    return {
      ...base,
      phase: 'human_input_required',
      title: '流程等待人工补充',
      detail: reason,
      missingDocuments,
      gate,
    };
  }
  if (run.status === 'blocked') {
    const reason = String(run.blocked_reason?.message ?? run.error?.message ?? '权威业务条件未满足');
    return {
      ...base,
      phase: 'blocked',
      title: '流程已安全阻断',
      detail: reason,
      missingDocuments,
      gate,
    };
  }
  if (run.status === 'data_incomplete') {
    const incomplete = (
      run.error as
        | { data_incomplete?: { title?: string; missing?: Array<Record<string, unknown>> } }
        | undefined
    )?.data_incomplete;
    const reason = String(
      run.blocked_reason?.message ??
        run.error?.message ??
        incomplete?.title ??
        '缺少权威数据，流程安全暂停；补齐后可继续运行',
    );
    return {
      ...base,
      phase: 'data_incomplete',
      title: '数据未完善',
      detail: reason,
      missing: incomplete?.missing,
      gate,
    };
  }
  if (run.status === 'cancelled') {
    const reason = String(run.error?.message ?? '人工已拒绝当前结果');
    return {
      ...base,
      phase: 'failed',
      title: '已拒绝，流程已停止',
      detail: reason,
      failed: true,
      error: reason,
    };
  }
  if (run.status === 'failed') {
    const reason = String(run.error?.message ?? '业务流程执行失败');
    return {
      ...base,
      phase: 'failed',
      title: '业务流程运行失败',
      detail: reason,
      failed: true,
      error: reason,
    };
  }
  if (run.status === 'completed') {
    const schedule = latestScheduleForTask(trace, run.tracking_task_id);
    const version = schedule?.source_schedule_id ?? schedule?.schedule_id;
    if (isSampleFlow) {
      return {
        ...base,
        phase: 'done',
        title: '打样流程已完成（样品/预订单）',
        detail: '未进入正式排程与采购',
      };
    }
    return {
      ...base,
      phase: 'done',
      title: '订单到排程 受治理链路已完成',
      detail: version ? `排程版本：${String(version)}` : '',
    };
  }
  if (isSampleFlow) {
    return {
      ...base,
      phase: 'm1_m2',
      title: '执行打样流程（简化 M2 → 打样执行 → 样品检验 → 样品库）',
      detail: '',
    };
  }
  if (['intake', 'resolve_order_from_m1', 'resolve_or_generate_bom'].includes(run.current_node)) {
    return {
      ...base,
      phase: 'm1_m2',
      title: '执行 M1 订单解析与 M2 BOM 流程',
      detail: '',
    };
  }
  if (
    [
      'calculate_material_requirements',
      'persist_procurement_plan',
      'create_or_update_purchase_orders',
      'check_material_readiness',
    ].includes(run.current_node)
  ) {
    return {
      ...base,
      phase: 'm3_m4',
      title: '执行 M3 物料计划与 M4 采购流程',
      detail: '',
    };
  }
  return {
    ...base,
    phase: 'm5',
    title: '执行 M5 权威排程',
    detail: '',
  };
};

export async function createBusinessFlow(
  payload: BusinessFlowCreateRequest,
  trackingTaskId: string,
  signal?: AbortSignal,
): Promise<BusinessFlowCreated> {
  const response = await requestJson<unknown>('/orchestrator/business-flows', {
    method: 'POST',
    headers: { 'X-Yunpai-Task-ID': trackingTaskId },
    body: payload,
    signal,
  });
  return businessFlowCreatedSchema.parse(response);
}

export async function getBusinessFlow(
  runId: string,
  signal?: AbortSignal,
): Promise<BusinessFlowRun> {
  const response = await requestJson<unknown>(
    `/orchestrator/business-flows/${encodeURIComponent(runId)}`,
    { signal },
  );
  return normalizeRun(businessFlowRunSchema.parse(response));
}

export async function getBusinessOrderTrace(
  orderId: string,
  signal?: AbortSignal,
): Promise<BusinessOrderTrace> {
  const response = await requestJson<unknown>(
    `/orchestrator/business-orders/${encodeURIComponent(orderId)}/trace`,
    { signal },
  );
  return businessOrderTraceSchema.parse(response);
}

export async function getBusinessFlowTrace(
  runId: string,
  signal?: AbortSignal,
): Promise<BusinessOrderTrace> {
  const response = await requestJson<unknown>(
    `/orchestrator/business-flows/${encodeURIComponent(runId)}/trace`,
    { signal },
  );
  return businessOrderTraceSchema.parse(response);
}

export async function getCatalogRunConfigs(): Promise<BusinessCatalogRunConfig[]> {
  const response = await fetch('/run-config/candidate-run-manifest.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`读取订单运行配置失败：${response.status}`);
  }
  const data = (await response.json()) as BusinessCatalogRunConfig[] | Record<string, unknown>;
  return Array.isArray(data) ? data : (data.items as BusinessCatalogRunConfig[] | undefined) ?? [];
}

export async function getBusinessTaskTrace(
  trackingTaskId: string,
  signal?: AbortSignal,
): Promise<BusinessTaskTrace> {
  const response = await requestJson<unknown>(
    `/orchestrator/business-tasks/${encodeURIComponent(trackingTaskId)}/trace`,
    { signal },
  );
  const trace = businessTaskTraceSchema.parse(response);
  return { ...trace, flow: normalizeRun(trace.flow) };
}

export async function runBusinessFlow(
  input: BusinessFlowRunInput,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    intervalMs?: number;
    onProgress?: (progress: BusinessFlowRunProgress) => void;
  } = {},
): Promise<BusinessFlowRunProgress> {
  const { signal, onProgress } = options;
  onProgress?.({
    phase: 'submitting',
    title: '提交受治理业务流程',
    detail: '浏览器只提交一次；后续模块交接由服务器 LangGraph 执行',
  });

  const encoded = input.orderFile ? await encodeFile(input.orderFile) : undefined;
  const contentDigest = encoded?.digestHex ?? await sha256Hex(`${input.orderId}:no-file`);
  const { trackingTaskId, idempotencyKey } = await createBusinessRunIdentity(
    `${input.catalogId}:${input.orderId}`,
    contentDigest,
  );
  const payload: BusinessFlowCreateRequest = {
    idempotency_key: idempotencyKey,
    order_id: input.orderId,
    order_number: input.orderNumber,
    mode: input.mode ?? 'real',
    order_type: input.orderType ?? 'normal',
    order_file:
      encoded && input.orderFilename
        ? {
            filename: input.orderFilename,
            content_type: input.orderFile?.type || 'application/octet-stream',
            content_b64: encoded.contentB64,
          }
        : undefined,
    m1_options: { semantic_enrichment: false },
    m2_payload: input.m2Input ?? defaultM2Payload(input),
    m3_payload: input.m3Input ?? null,
    m4_payload: input.m4Input ?? {},
    // Empty means "use valid suggestion IDs returned by this flow's M4 import".
    m4_generate_payload: input.m4GenerateInput ?? {},
    m5_payload: input.m5Input ?? null,
    replace_m3_bom_with_m2: true,
    session_id: `business-${input.catalogId}`.slice(0, 128),
  };

  const created = await createBusinessFlow(payload, trackingTaskId, signal);
  return pollBusinessFlowRun(created.run_id, input.orderId, { signal, onProgress, timeoutMs: options.timeoutMs, intervalMs: options.intervalMs });
}

async function pollBusinessFlowRun(
  runId: string,
  orderId: string,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    intervalMs?: number;
    onProgress?: (progress: BusinessFlowRunProgress) => void;
  } = {},
): Promise<BusinessFlowRunProgress> {
  const { signal, onProgress } = options;
  const deadline = Date.now() + (options.timeoutMs ?? 300_000);
  const intervalMs = options.intervalMs ?? 1_500;

  while (true) {
    if (signal?.aborted) {
      throw new DOMException('任务已取消', 'AbortError');
    }
    const run = await getBusinessFlow(runId, signal);
    if (!['queued', 'running'].includes(run.status)) {
      // 上传文件类订单的 order_id 可能是文件名（含中文等），trace 接口可能拒绝；
      // trace 只是展示增强，失败不阻断闸门/终态展示。
      let trace;
      // 优先按 run_id（ASCII）取 trace：上传订单中文文件名经网关编码路径会被
      // auth_request 400 拒绝，run_id 路径绕开 URL 编码。
      try {
        trace = await getBusinessFlowTrace(runId, signal);
      } catch {
        try {
          trace = await getBusinessOrderTrace(orderId, signal);
        } catch {
          trace = undefined;
        }
      }
      const terminal = businessFlowRunProgress(run, trace);
      onProgress?.(terminal);
      return terminal;
    }
    onProgress?.(businessFlowRunProgress(run));
    if (Date.now() >= deadline) {
      throw new Error(`业务流程超时：${runId}`);
    }
    await sleep(intervalMs);
  }
}

export async function runCatalogBusinessFlow(
  config: BusinessCatalogRunConfig,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    intervalMs?: number;
    onProgress?: (progress: BusinessFlowRunProgress) => void;
  } = {},
): Promise<BusinessFlowRunProgress> {
  const { signal, onProgress } = options;
  const orderId = config.order?.order_id ?? '';
  if (!orderId) {
    throw new Error('运行配置缺少订单号');
  }
  onProgress?.({
    phase: 'm1_m2',
    title: '准备受治理订单输入',
    detail: `读取订单文件与本订单的权威物料计算上下文 · ${orderId}`,
  });

  const [orderResponse, m3Response] = await Promise.all([
    fetch(config.order_url, { cache: 'no-store' }),
    fetch(config.m3_input_url, { cache: 'no-store' }),
  ]);
  if (!orderResponse.ok) {
    throw new Error(`读取订单文件失败：${orderResponse.status}`);
  }
  if (!m3Response.ok) {
    throw new Error(`读取物料计算输入失败：${m3Response.status}`);
  }
  const orderBlob = await orderResponse.blob();
  const m3Input = (await m3Response.json()) as Record<string, unknown>;
  const m3Order = (m3Input.order ?? {}) as { order_id?: string };
  if (m3Order.order_id !== orderId) {
    throw new Error('运行配置与当前订单号不一致，已拒绝执行');
  }

  const encoded = await encodeFile(orderBlob);
  const { trackingTaskId, idempotencyKey } = await createBusinessRunIdentity(
    `${config.catalog_id}:${orderId}`,
    encoded.digestHex,
  );
  const configuredPurpose = (config.m5_payload as { scenario_purpose?: string } | null | undefined)?.scenario_purpose;
  const mode: 'real' | 'pressure_only' =
    config.mode === 'pressure_only' || configuredPurpose === 'pressure_only' ? 'pressure_only' : 'real';
  const historyBomPath = config.order?.bom_excel_path || config.history_bom_path;
  const m2Payload = {
    product_profile: { product_name: config.order?.product_name ?? orderId, product_code: config.product_code ?? '' },
    requirement_text: `订单 ${orderId}，数量 ${config.order?.order_qty ?? '待确认'} ${config.order?.unit ?? ''}，交期 ${config.order?.due_date ?? '待确认'}。仅使用已提供的历史 BOM 和证据；缺失事实时请求人工补充。`,
    rule_package_path: '',
    use_demo_sources: false,
    history_bom_paths: historyBomPath ? [historyBomPath] : [],
    template_confirmation: { confirmed: true },
    customer_answers: { manual_message: '' },
    enable_bom_model: false,
    enable_sop_model: false,
  };
  const payload: BusinessFlowCreateRequest = {
    idempotency_key: idempotencyKey,
    order_id: orderId,
    order_number: config.order?.order_number || orderId,
    mode,
    order_type: 'normal',
    order_file: {
      filename: config.order_filename,
      content_type: orderBlob.type || 'application/octet-stream',
      content_b64: encoded.contentB64,
    },
    m1_options: { semantic_enrichment: false },
    m2_payload: m2Payload,
    m3_payload: m3Input,
    m4_payload: config.m4_payload ?? {},
    m4_generate_payload: config.m4_generate_payload === undefined ? {} : config.m4_generate_payload,
    m5_payload: config.m5_payload ?? null,
    replace_m3_bom_with_m2: true,
    session_id: `business-${config.catalog_id}`.slice(0, 128),
  };

  const created = await createBusinessFlow(payload, trackingTaskId, signal);
  return pollBusinessFlowRun(created.run_id, orderId, { signal, onProgress, timeoutMs: options.timeoutMs, intervalMs: options.intervalMs });
}

/**
 * 强制新运行：使用唯一 trackingTaskId/idempotency_key，规避历史 run 的幂等 409。
 * 页面「样例订单」联动触发当前选中订单运行；若同订单已有不同 payload 的历史 run，
 * 普通 runCatalogBusinessFlow 会 409，改用本函数重试。
 */
export async function runCatalogBusinessFlowForce(
  config: BusinessCatalogRunConfig,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    intervalMs?: number;
    onProgress?: (progress: BusinessFlowRunProgress) => void;
  } = {},
): Promise<BusinessFlowRunProgress> {
  const { signal, onProgress } = options;
  const orderId = config.order?.order_id ?? '';
  if (!orderId) {
    throw new Error('运行配置缺少订单号');
  }
  onProgress?.({
    phase: 'm1_m2',
    title: '准备受治理订单输入（强制新运行）',
    detail: `读取订单文件与本订单的权威物料计算上下文 · ${orderId}`,
  });

  const [orderResponse, m3Response] = await Promise.all([
    fetch(config.order_url, { cache: 'no-store' }),
    fetch(config.m3_input_url, { cache: 'no-store' }),
  ]);
  if (!orderResponse.ok) {
    throw new Error(`读取订单文件失败：${orderResponse.status}`);
  }
  if (!m3Response.ok) {
    throw new Error(`读取物料计算输入失败：${m3Response.status}`);
  }
  const orderBlob = await orderResponse.blob();
  const m3Input = (await m3Response.json()) as Record<string, unknown>;
  const m3Order = (m3Input.order ?? {}) as { order_id?: string };
  if (m3Order.order_id !== orderId) {
    throw new Error('运行配置与当前订单号不一致，已拒绝执行');
  }

  const encoded = await encodeFile(orderBlob);
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const configuredPurpose = (config.m5_payload as { scenario_purpose?: string } | null | undefined)?.scenario_purpose;
  const mode: 'real' | 'pressure_only' =
    config.mode === 'pressure_only' || configuredPurpose === 'pressure_only' ? 'pressure_only' : 'real';
  const historyBomPath = config.order?.bom_excel_path || config.history_bom_path;
  const m2Payload = {
    product_profile: { product_name: config.order?.product_name ?? orderId, product_code: config.product_code ?? '' },
    requirement_text: `订单 ${orderId}，数量 ${config.order?.order_qty ?? '待确认'} ${config.order?.unit ?? ''}，交期 ${config.order?.due_date ?? '待确认'}。仅使用已提供的历史 BOM 和证据；缺失事实时请求人工补充。`,
    rule_package_path: '',
    use_demo_sources: false,
    history_bom_paths: historyBomPath ? [historyBomPath] : [],
    template_confirmation: { confirmed: true },
    customer_answers: { manual_message: '' },
    enable_bom_model: false,
    enable_sop_model: false,
  };
  const payload: BusinessFlowCreateRequest = {
    idempotency_key: `business:${config.catalog_id}:ui-${unique}`.slice(0, 256),
    order_id: orderId,
    order_number: config.order?.order_number || orderId,
    mode,
    order_type: 'normal',
    order_file: {
      filename: config.order_filename,
      content_type: orderBlob.type || 'application/octet-stream',
      content_b64: encoded.contentB64,
    },
    m1_options: { semantic_enrichment: false },
    m2_payload: m2Payload,
    m3_payload: m3Input,
    m4_payload: config.m4_payload ?? {},
    m4_generate_payload: config.m4_generate_payload === undefined ? {} : config.m4_generate_payload,
    m5_payload: config.m5_payload ?? null,
    replace_m3_bom_with_m2: true,
    session_id: `business-ui-${unique}`.slice(0, 128),
  };

  const trackingTaskId = `task_ui_${unique}`;
  const created = await createBusinessFlow(payload, trackingTaskId, signal);
  return pollBusinessFlowRun(created.run_id, orderId, { signal, onProgress, timeoutMs: options.timeoutMs, intervalMs: options.intervalMs });
}

export async function resumeBusinessFlow(
  runId: string,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    intervalMs?: number;
    orderId?: string;
    action?: BusinessFlowResumeAction;
    gateCode?: string;
    evidenceDigest?: string;
    supplement?: Record<string, unknown>;
    comment?: string;
    onProgress?: (progress: BusinessFlowRunProgress) => void;
  } = {},
): Promise<BusinessFlowRunProgress> {
  const { signal, onProgress } = options;
  onProgress?.({
    phase: 'm1_m2',
    title: '已提交继续运行',
    detail: `run ${runId} 正在重新执行，等待服务器 LangGraph 推进`,
    runId,
  });

  await resumeBusinessFlowRequest(runId, signal, {
    action: options.action ?? 'continue',
    gateCode: options.gateCode,
    evidenceDigest: options.evidenceDigest,
    supplement: options.supplement,
    comment: options.comment,
  });
  const deadline = Date.now() + (options.timeoutMs ?? 300_000);
  const intervalMs = options.intervalMs ?? 1_500;

  while (true) {
    if (signal?.aborted) {
      throw new DOMException('任务已取消', 'AbortError');
    }
    const run = await getBusinessFlow(runId, signal);
    if (!['queued', 'running'].includes(run.status)) {
      let trace;
      if (options.orderId) {
        try {
          trace = await getBusinessFlowTrace(runId, signal);
        } catch {
          try {
            trace = await getBusinessOrderTrace(options.orderId, signal);
          } catch {
            trace = undefined;
          }
        }
      }
      const terminal = businessFlowRunProgress(run, trace);
      onProgress?.(terminal);
      return terminal;
    }
    onProgress?.(businessFlowRunProgress(run));
    if (Date.now() >= deadline) {
      throw new Error(`业务流程超时：${runId}`);
    }
    await sleep(intervalMs);
  }
}

export async function resumeBusinessFlowRequest(
  runId: string,
  signal?: AbortSignal,
  command: BusinessFlowResumeCommand = {},
): Promise<{ run_id: string; status: string; current_node?: string }> {
  return requestJson<{ run_id: string; status: string; current_node?: string }>(
    `/orchestrator/business-flows/${encodeURIComponent(runId)}/resume`,
    {
      method: 'POST',
      body: {
        action: command.action ?? 'continue',
        ...(command.gateCode ? { gate_code: command.gateCode } : {}),
        ...(command.evidenceDigest ? { evidence_digest: command.evidenceDigest } : {}),
        ...(command.supplement ? { supplement: command.supplement } : {}),
        ...(command.comment ? { comment: command.comment } : {}),
      },
      signal,
    },
  );
}
