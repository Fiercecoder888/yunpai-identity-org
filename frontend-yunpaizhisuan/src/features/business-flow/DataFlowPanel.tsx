import {
  CalculatorOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DownOutlined,
  EyeOutlined,
  FileSearchOutlined,
  LoadingOutlined,
  PartitionOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  CloudUploadOutlined,
  ShoppingCartOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Collapse, Input, InputNumber, Modal, Radio, Select, Space, Tag, Tooltip, message } from 'antd';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ActionGate } from '../../components/ActionGate';
import { getBusinessFlowOrders, type BusinessFlowOrder } from '../../services/businessFlowApi';
import {
  getBusinessOrderTrace,
  getCatalogRunConfigs,
  resumeBusinessFlow,
  runCatalogBusinessFlow,
  runCatalogBusinessFlowForce,
  type BusinessFlowRun,
  type BusinessFlowRunProgress,
  type BusinessOrderTrace,
} from '../../services/businessFlowRunApi';
import { HttpClientError, requestJson } from '../../services/httpClient';
import { getM5Schedule } from '../../services/m5Api';
import { getAgentTasks, type AgentCode } from '../../services/taskApi';
import { useAuthStore } from '../../auth/useAuthStore';
import { useChatStore } from '../../store/useChatStore';
import { useBusinessRunStore, type BusinessRunMeta } from './useBusinessRunStore';
import { DataPreviewModal, type DataPreviewColumn } from './DataPreviewModal';
import { M5ScheduleSummary } from './M5ScheduleSummary';
import { UploadContextBar } from './UploadContextBar';
import { TaskId } from '../../components/TaskId';
import { useCurrentRole } from '../roles/useCurrentRole';
import { hasPermission, type PermissionCode } from '../../services/permissionApi';
import styles from './DataFlowPanel.module.css';

const SELECTED_ORDER_KEY = 'yunpai-business-flow-selected-order';
const EXPANDED_KEY = 'yunpai.data-flow-panel.expanded';

const STAGES = [
  { id: 'm1', name: '订单输入', icon: <FileSearchOutlined /> },
  { id: 'm2', name: 'BOM 匹配', icon: <PartitionOutlined /> },
  { id: 'm3', name: '物料计算', icon: <CalculatorOutlined /> },
  { id: 'm4', name: '采购入库', icon: <ShoppingCartOutlined /> },
  { id: 'm5', name: '生产排程', icon: <CalendarOutlined /> },
] as const;

type StageStatus = 'idle' | 'running' | 'ok' | 'data' | 'attention' | 'failed';
type StageId = (typeof STAGES)[number]['id'];

const RECOVERABLE_GATE_STATES = new Set(['human_input_required', 'blocked', 'data_incomplete']);

const isRecoverableGateState = (
  phase: BusinessFlowRunProgress['phase'] | undefined,
  runStatus: BusinessFlowRun['status'] | undefined,
) => Boolean(
  phase &&
  runStatus &&
  RECOVERABLE_GATE_STATES.has(phase) &&
  RECOVERABLE_GATE_STATES.has(runStatus),
);

function FlowActionGate({
  targetId,
  permission = 'm4:operate',
  children,
}: {
  targetId: string;
  permission?: PermissionCode;
  children: ReactElement;
}) {
  return (
    <ActionGate
      permission={permission}
      auditModule="BusinessFlow"
      targetId={targetId}
    >
      {children}
    </ActionGate>
  );
}

const statusTag = (status: StageStatus) => {
  switch (status) {
    case 'ok':
      return <Tag color="success">完成</Tag>;
    case 'data':
      return <Tag color="default">已有数据</Tag>;
    case 'running':
      return <Tag color="processing" icon={<LoadingOutlined />}>运行中</Tag>;
    case 'attention':
      return <Tag color="warning">需人工</Tag>;
    case 'failed':
      return <Tag color="error">失败</Tag>;
    default:
      return <Tag>待执行</Tag>;
  }
};

const nodeToModule = (node?: string): StageId | undefined => {
  const name = String(node ?? '').toLowerCase();
  if (!name) return undefined;
  if (name.includes('intake') || name.includes('resolve_order') || name.includes('ingest')) return 'm1';
  if (name.includes('bom')) return 'm2';
  if (name.includes('material') || name.includes('mrp') || name.includes('procurement_plan') || name.includes('shortage')) return 'm3';
  if (name.includes('purchase') || name.includes('readiness')) return 'm4';
  if (name.includes('schedule') || name.includes('solve')) return 'm5';
  return undefined;
};

const hasStageEvidence = (stageId: StageId, trace?: BusinessOrderTrace): boolean => {
  if (!trace) return false;
  if (stageId === 'm1') return Boolean(trace.order);
  if (stageId === 'm2') return activeMaterials(trace).length > 0;
  if (stageId === 'm3') return activeMaterials(trace).length > 0;
  if (stageId === 'm4') return trace.procurement_plan_lines.length > 0 || trace.purchase_orders.length > 0;
  if (stageId === 'm5') return trace.schedule_versions.length > 0;
  return false;
};

const activeMaterials = (trace: BusinessOrderTrace) =>
  trace.order_materials.filter(
    (item) => String(item.lifecycle_status ?? '').toLowerCase() !== 'superseded',
  );

const scheduleVersion = (schedule?: Record<string, unknown>) => {
  const value = schedule?.source_schedule_id ?? schedule?.schedule_id;
  return value == null ? undefined : String(value);
};

const latestScheduleForTask = (
  trace: BusinessOrderTrace | undefined,
  trackingTaskId: string | undefined,
) => {
  if (!trackingTaskId) return undefined;
  return [...(trace?.schedule_versions ?? [])]
    .reverse()
    .find((schedule) => String(schedule.tracking_task_id ?? '') === trackingTaskId);
};

const completedRunModules = (run?: BusinessFlowRun): Set<string> => {
  const completed = new Set<string>();
  for (const step of run?.steps ?? []) {
    const module = String(step.module ?? '');
    const status = String(step.status ?? '');
    if (/^m[1-5]$/.test(module) && ['completed', 'ok', 'skipped'].includes(status)) completed.add(module);
  }
  return completed;
};

const stageStates = (run?: BusinessFlowRun, trace?: BusinessOrderTrace): StageStatus[] => {
  if (!run && !trace) {
    return STAGES.map(() => 'idle');
  }
  const completed = completedRunModules(run);
  if (!run) {
    return STAGES.map((stage) => (hasStageEvidence(stage.id, trace) ? 'ok' : 'idle'));
  }
  if (run?.status === 'completed') {
    return STAGES.map(() => 'ok');
  }
  const currentModule = nodeToModule(run.current_node);
  const lastStepModule = [...(run.steps ?? [])].reverse().find((step) => /^m[1-5]$/.test(String(step.module ?? '')));
  const activeModule = currentModule ?? String(lastStepModule?.module ?? '');
  return STAGES.map((stage) => {
    if (completed.has(stage.id)) return 'ok';
    // 历史 trace 有数据不等于本轮已完成：未在本轮完成的阶段只显示「已有数据」。
    if (hasStageEvidence(stage.id, trace)) return 'data';
    if (stage.id !== activeModule) return 'idle';
    if (run.status === 'failed') return 'failed';
    if (run.status === 'human_input_required' || run.status === 'blocked' || run.status === 'data_incomplete') return 'attention';
    return 'running';
  });
};

const stageSummary = (stageId: string, trace?: BusinessOrderTrace, run?: BusinessFlowRun): string | undefined => {
  if (!trace) return undefined;
  if (run && run.status !== 'completed' && !completedRunModules(run).has(stageId)) return undefined;
  if (stageId === 'm1') {
    return trace.order ? `${String(trace.order.order_id ?? '')}` : undefined;
  }
  if (stageId === 'm2') {
    const m2 = (run?.results as Record<string, unknown> | undefined)?.m2 as Record<string, unknown> | undefined;
    const lines = (m2?.result as Record<string, unknown> | undefined)?.bom_lines ?? m2?.bom_lines;
    return Array.isArray(lines) && lines.length ? `${lines.length} 行 BOM` : undefined;
  }
  if (stageId === 'm3') {
    const count = activeMaterials(trace).length;
    return count ? `${count} 种物料` : undefined;
  }
  if (stageId === 'm4') {
    if (trace.procurement_plan_lines.length) return `${trace.procurement_plan_lines.length} 条采购建议`;
    if (trace.purchase_orders.length) return `${trace.purchase_orders.length} 张采购单`;
    return undefined;
  }
  const schedule = trace.schedule_versions.at(-1);
  const version = schedule?.source_schedule_id ?? schedule?.schedule_id;
  return version ? `排程 ${String(version)}` : undefined;
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

// 业务流运行与当前对话绑定：切换对话后，旧对话还在轮询的运行不得把进度画到新对话的面板上。
const NO_CONVERSATION = '__no-conversation__';
const currentConversationId = () => useChatStore.getState().selectedConversationId ?? NO_CONVERSATION;
const guardFlowUpdatesFor =
  (conversationId: string, onProgress: (next: BusinessFlowRunProgress) => void) =>
  (next: BusinessFlowRunProgress) => {
    // 仅当用户仍停留在发起运行的那个对话时，才把进度写入全局面板。
    if (currentConversationId() === conversationId) onProgress(next);
  };

type M2Question = {
  field?: string;
  question_id?: string;
  question?: string;
  blocking?: boolean;
  default_policy?: string;
  reason?: string;
  affected_lines?: Array<string | Record<string, unknown>>;
  options?: Array<{ value?: string; label?: string } | string>;
};
type BomApprovalLine = {
  component_item?: string;
  component_name?: string;
  qty_per?: unknown;
  uom?: string;
  scrap_pct?: unknown;
  supply_type?: string;
};
type M1OrderLine = { name_raw?: string; name?: string; product_name?: string; model?: string; product_code?: string; quantity?: number; uom?: string };
type ShortageRow = { material_code: string; material_name?: string; shortage_qty?: number; suggest_purchase_qty?: number; uom?: string };
type MatchingCandidate = { material_code: string; material_name?: string; score?: number; conflicts?: string };
type MatchingReview = {
  material_code: string;
  material_name: string;
  candidateCode?: string;
  candidateScore?: number;
  candidates: MatchingCandidate[];
};

const hasPositiveQuantity = (value: unknown) => {
  const quantity = Number(String(value ?? '').trim());
  return Number.isFinite(quantity) && quantity > 0;
};

/**
 * 人工确认门三按钮组（确认 / 需要补充信息 / 退出受治理流程）。
 * - 主按钮：confirmLabel，触发 onConfirm；
 * - 补充按钮：首次点击展开 supplementContent 表单并聚焦首个输入，填好后点击「已补充完毕可以继续」触发 onSupplement；
 * - 退出按钮：onExit（重置面板并结束本轮人工介入）。
 */
function GateConfirm({
  confirmLabel,
  supplementReady,
  supplementContent,
  busy,
  confirmDisabled = false,
  disabled = false,
  onConfirm,
  onSupplement,
  onExit,
}: {
  confirmLabel: string;
  supplementReady?: boolean;
  supplementContent?: React.ReactNode;
  busy?: 'confirm' | 'supplement';
  confirmDisabled?: boolean;
  /** 权限守卫（FlowActionGate）未放行时由 ActionGate 注入的禁用标记，传递给三个按钮 */
  disabled?: boolean;
  onConfirm: () => void;
  onSupplement?: () => void;
  onExit: () => void;
}) {
  const [supplementOpen, setSupplementOpen] = useState(false);
  const supplementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (supplementOpen) {
      supplementRef.current
        ?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLElement>('input, textarea, [tabindex]')
        ?.focus();
    }
  }, [supplementOpen]);

  const handleSupplement = () => {
    if (!supplementOpen) {
      setSupplementOpen(true);
      return;
    }
    if (supplementReady) onSupplement?.();
  };

  return (
    <div className={styles.gateConfirmRoot}>
      {supplementOpen ? (
        <div ref={supplementRef} className={styles.gateConfirmSupplement}>
          <Alert type="warning" showIcon message="请填写补充信息" />
          {supplementContent}
        </div>
      ) : null}
      <div className={styles.gateConfirmActions}>
        <Button
          type="primary"
          className={styles.gateConfirmPrimary}
          loading={busy === 'confirm'}
          disabled={disabled || confirmDisabled || busy === 'supplement'}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
        <Button
          className={styles.gateConfirmSupplementButton}
          loading={busy === 'supplement'}
          disabled={disabled || busy === 'confirm'}
          onClick={handleSupplement}
        >
          {supplementReady ? '已补充完毕可以继续' : '需要补充信息'}
        </Button>
        <Button className={styles.gateConfirmExit} disabled={disabled || !!busy} onClick={onExit}>
          退出受治理流程
        </Button>
      </div>
    </div>
  );
}

export function DataFlowPanel({
  pmcProgressRequest = 0,
  readOnly = false,
  initiallyExpanded = false,
}: {
  pmcProgressRequest?: number;
  readOnly?: boolean;
  initiallyExpanded?: boolean;
}) {
  const store = useBusinessRunStore();
  const tenantId = useAuthStore((state) => state.me?.tenant.id);
  const [selectedCatalogId, setSelectedCatalogId] = useState('');
  const [manualM2Note, setManualM2Note] = useState('');
  const [supplementBomNote, setSupplementBomNote] = useState('');
  const [supplementGateNote, setSupplementGateNote] = useState('');
  const [m2Choices, setM2Choices] = useState<Record<string, string>>({});
  const [m1Review, setM1Review] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, number>>({});
  const [manualMatchingOpen, setManualMatchingOpen] = useState(false);
  const [exceptionEditorOpen, setExceptionEditorOpen] = useState(false);
  const [manualChoices, setManualChoices] = useState<Record<string, string>>({});
  const [manualCustom, setManualCustom] = useState<Record<string, string>>({});
  // 通用「人工确认明细预览」弹窗（M1 订单明细 / M2 物料明细 / M3 BOM 明细共用）
  const [preview, setPreview] = useState<{ title: string; columns: DataPreviewColumn[]; rows: Array<Record<string, unknown>> } | null>(null);
  const [busy, setBusy] = useState<string>();
  const [expanded, setExpanded] = useState(() => initiallyExpanded || localStorage.getItem(EXPANDED_KEY) === 'true');
  const prevActive = useRef(false);
  const lastPmcProgressRequest = useRef(0);
  const viewOrderRequestSequence = useRef(0);
  const panelRef = useRef<HTMLElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const ordersQuery = useQuery({ queryKey: ['business-flow-orders'], queryFn: getBusinessFlowOrders, staleTime: 60_000 });
  const catalogConfigsQuery = useQuery({ queryKey: ['business-catalog-run-configs'], queryFn: getCatalogRunConfigs, staleTime: 300_000 });
  const agentTasksQuery = useQuery({
    queryKey: ['agent-tasks', tenantId],
    queryFn: () => getAgentTasks({ includeDismissed: true }),
    enabled: Boolean(tenantId),
    refetchInterval: 15_000,
  });
  const agentTaskCounts = useMemo(() => {
    const counts: Record<AgentCode, number> = { m0: 0, m1: 0, m2: 0, m3: 0, m4: 0, m5: 0 };
    (agentTasksQuery.data ?? []).forEach((task) => {
      if (!task.is_history) counts[task.agent] += 1;
    });
    return counts;
  }, [agentTasksQuery.data]);
  const roleQuery = useCurrentRole();
  const canOperateBusinessFlow = hasPermission(roleQuery.data, 'm4:operate');
  const canApproveBom = canOperateBusinessFlow && hasPermission(roleQuery.data, 'm0:bom:approve');
  const canLoadM5Fixture = canOperateBusinessFlow && hasPermission(roleQuery.data, 'schedule:write');

  useEffect(() => {
    if (!ordersQuery.data?.length || selectedCatalogId) return;
    const stored = localStorage.getItem(SELECTED_ORDER_KEY);
    const selected = ordersQuery.data.find((order) => order.catalogId === stored)
      ?? ordersQuery.data.find((order) => order.taskId)
      ?? ordersQuery.data.find((order) => order.runnable)
      ?? ordersQuery.data[0];
    if (selected) {
      setSelectedCatalogId(selected.catalogId);
      useBusinessRunStore.getState().setSelectedCatalogId(selected.catalogId);
    }
  }, [ordersQuery.data, selectedCatalogId]);

  // 上传订单/其它入口更新 store.selectedCatalogId（如 upload-文件名-大小）时，
  // 同步到面板本地选择器，避免顶部仍显示上一次选中的受控订单（如 CAND-088）。
  const storeSelectedCatalogId = useBusinessRunStore((state) => state.selectedCatalogId);
  useEffect(() => {
    if (storeSelectedCatalogId && storeSelectedCatalogId !== selectedCatalogId) {
      setSelectedCatalogId(storeSelectedCatalogId);
    }
  }, [storeSelectedCatalogId, selectedCatalogId]);

  const { run, trace, meta, phase, title, detail, error: runError, m5FixtureLoaded, missing, missingDocuments, gate } = store;
  const activeRunId = store.runId ?? run?.run_id;
  const exceptionGate = gate?.gateKind === 'exception' ? gate : undefined;
  const isSimulatedEngineeringRouteGate =
    exceptionGate?.gateCode === 'm2_engineering_route_unmatched';
  const isBomPublicationExceptionGate =
    exceptionGate?.gateCode === 'm3_bom_publication'
    || exceptionGate?.gateCode === 'm0_bom_publication_retry';
  const phaseNeedsAttention =
    phase === 'human_input_required' ||
    phase === 'blocked' ||
    phase === 'data_incomplete';
  const isCompleted = run?.status === 'completed' || (run?.status !== 'failed' && phase === 'done');
  const isFailed = run?.status === 'failed' || (!isCompleted && phase === 'failed');
  const canOperateGate = isRecoverableGateState(phase, run?.status);
  const showAttention = isFailed || (!isCompleted && phaseNeedsAttention);
  useEffect(() => {
    if (store.active && !prevActive.current) setExpanded(true);
    prevActive.current = store.active;
  }, [store.active]);

  // 进入人工确认/阻断/失败时强制展开大屏，避免确认卡被折叠区隐藏
  // （首次运行自动展开只在 active 首次变 true 时触发；若用户此前预览过或手动收起，
  //  后续闸门不会自动展开，导致人工确认“不弹出”）。
  const prevAttention = useRef(false);
  useEffect(() => {
    if (showAttention && !prevAttention.current) setExpanded(true);
    prevAttention.current = showAttention;
  }, [showAttention]);

  useEffect(() => {
    if ((!canOperateGate || !canOperateBusinessFlow) && manualMatchingOpen) {
      setManualMatchingOpen(false);
    }
  }, [canOperateBusinessFlow, canOperateGate, manualMatchingOpen]);

  useEffect(() => {
    setExceptionEditorOpen(false);
  }, [gate?.evidenceDigest]);

  useEffect(() => {
    setM1Review({});
  }, [activeRunId]);

  useEffect(() => {
    localStorage.setItem(EXPANDED_KEY, String(expanded));
  }, [expanded]);

  useEffect(() => {
    const focusTask = () => setExpanded(true);
    window.addEventListener('yunpai:focus-business-flow-task', focusTask);
    return () => window.removeEventListener('yunpai:focus-business-flow-task', focusTask);
  }, []);

  useLayoutEffect(() => {
    if (!expanded) return;
    const panel = panelRef.current;
    const overlay = overlayRef.current;
    if (!panel || !overlay) return;

    const shell = panel.closest('.assistant-shell');
    const composer = shell?.querySelector<HTMLElement>('.chat-composer');
    const updateMaxHeight = () => {
      const boundary = Math.min(
        window.innerHeight,
        composer?.getBoundingClientRect().top ?? window.innerHeight,
      );
      const availableHeight = Math.max(0, Math.floor(boundary - panel.getBoundingClientRect().bottom));
      overlay.style.maxHeight = `${availableHeight}px`;
    };

    updateMaxHeight();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(updateMaxHeight);
    observer?.observe(panel);
    if (composer) observer?.observe(composer);
    window.addEventListener('resize', updateMaxHeight);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateMaxHeight);
    };
  }, [expanded]);

  const selectedOrder = ordersQuery.data?.find((order) => order.catalogId === selectedCatalogId);
  const statuses = useMemo(() => stageStates(run, trace), [run, trace]);
  const orderId = meta.orderId ?? (trace?.order?.order_id ? String(trace.order.order_id) : selectedOrder?.orderId);
  const isHistoricalPreview = store.active && !store.running && phase === undefined;
  const currentSchedule = useMemo(
    () => latestScheduleForTask(trace, run?.tracking_task_id ?? store.taskId),
    [run?.tracking_task_id, store.taskId, trace],
  );
  const historicalSchedule = useMemo(
    () => trace?.schedule_versions.at(-1),
    [trace],
  );
  const planVersion = scheduleVersion(
    isHistoricalPreview ? historicalSchedule : currentSchedule,
  );
  const historicalPlanVersion = scheduleVersion(historicalSchedule);
  const showHistoricalScheduleNotice = Boolean(
    store.active &&
    !isHistoricalPreview &&
    !planVersion &&
    historicalPlanVersion,
  );
  const pmcQuery = useQuery({
    queryKey: ['m5-schedule-detail', planVersion],
    queryFn: () => getM5Schedule(String(planVersion ?? '')),
    // 当前运行只读取同一 TaskID 的排程；只读预览才允许展示订单历史排程。
    enabled: Boolean(planVersion),
  });

  const m2Questions = useMemo<M2Question[]>(() => {
    const m2 = (run?.results as Record<string, unknown> | undefined)?.m2 as Record<string, unknown> | undefined;
    const payload = (m2?.result ?? m2) as {
      open_customer_questions?: M2Question[];
      open_questions?: M2Question[];
      bom_generation?: { open_questions?: M2Question[]; bom_baseline?: { open_questions?: M2Question[] } };
      template_onboarding?: { customer_questions?: M2Question[] };
      sop_template?: { customer_questions?: M2Question[] };
    } | undefined;
    // M2 响应结构随轮次变化：问题可能在外层 open_customer_questions/open_questions，
    // 也可能在 bom_generation.open_questions / bom_baseline.open_questions、
    // template_onboarding.customer_questions / sop_template.customer_questions 内层。
    // 注意：多条问题可能共用同一 field（如 history_mapping 系列），去重必须以
    // 唯一 question_id 为准，否则同 field 的后续问题会被 Map 吞掉（显示不全）。
    const questions = [
      ...(payload?.open_customer_questions ?? []),
      ...(payload?.open_questions ?? []),
      ...(payload?.bom_generation?.open_questions ?? []),
      ...(payload?.bom_generation?.bom_baseline?.open_questions ?? []),
      ...(payload?.template_onboarding?.customer_questions ?? []),
      ...(payload?.sop_template?.customer_questions ?? []),
    ];
    const unique = new Map<string, M2Question>();
    for (const question of questions) {
      const key = question.question_id ?? question.field ?? JSON.stringify(question);
      unique.set(key, question);
    }
    return [...unique.values()];
  }, [run]);

  // M2 生成的标准 BOM 明细（用于「审核并批准 BOM」门展示）
  const bomApprovalLines = useMemo<BomApprovalLine[]>(() => {
    const results = run?.results as Record<string, unknown> | undefined;
    const candidate = results?.m2_bom_publication_candidate as { bom_lines?: BomApprovalLine[] } | undefined;
    if (candidate?.bom_lines?.length) return candidate.bom_lines;
    const m2 = results?.m2 as Record<string, unknown> | undefined;
    const payload = (m2?.result ?? m2) as {
      bom_generation?: { standard_bom?: { bom_lines?: BomApprovalLine[] } };
    } | undefined;
    return payload?.bom_generation?.standard_bom?.bom_lines ?? [];
  }, [run]);

  const shortages = useMemo<ShortageRow[]>(() => {
    // 权威口径：正式 M3 计划（results.m3）的 shortage_lines；
    // 快照仅作兜底（历史订单的快照可能陈旧）。
    const m3 = (run?.results as Record<string, unknown> | undefined)?.m3 as Record<string, unknown> | undefined;
    const m3Data = (m3?.data ?? m3) as { shortage_lines?: ShortageRow[] } | undefined;
    const fromPlan = m3Data?.shortage_lines ?? [];
    const readiness = (run?.results as Record<string, unknown> | undefined)?.material_readiness as Record<string, unknown> | undefined;
    const data = (readiness?.data ?? readiness) as { critical_shortages?: ShortageRow[]; shortages?: ShortageRow[] } | undefined;
    return [...fromPlan, ...(data?.critical_shortages ?? []), ...(data?.shortages ?? [])].filter(
      (item, index, list) => item.material_code && list.findIndex((other) => other.material_code === item.material_code) === index,
    );
  }, [run]);
  const simulatedProcurementReceipt = (
    (run?.results as Record<string, unknown> | undefined)?.simulated_procurement_receipt
  ) as { status?: string; simulation_only?: boolean } | undefined;
  const hasSimulatedProcurementReceipt = Boolean(
    simulatedProcurementReceipt?.status === 'all_received'
    && simulatedProcurementReceipt.simulation_only,
  );
  const simulatedEngineeringRouteReceipt = (
    (run?.results as Record<string, unknown> | undefined)?.simulated_engineering_route_receipt
  ) as { status?: string; simulation_only?: boolean } | undefined;
  const hasSimulatedEngineeringRouteReceipt = Boolean(
    simulatedEngineeringRouteReceipt?.status === 'approved'
    && simulatedEngineeringRouteReceipt.simulation_only,
  );
  const m5FailureText = `${detail ?? ''} ${runError ?? ''} ${JSON.stringify(run?.error ?? {})}`;
  const isM5MaterialReadinessFailure = isFailed
    && /M5_SCHEDULE_READINESS_FAILED/.test(m5FailureText)
    && /material-or-kitting/.test(m5FailureText);
  const canConfirmSimulatedProcurement = canOperateBusinessFlow && shortages.length > 0 && (
    (canOperateGate && exceptionGate?.gateCode === 'm3_material_shortage')
    || isM5MaterialReadinessFailure
  );

  const m3Matching = useMemo<MatchingReview[]>(() => {
    const m3 = (run?.results as Record<string, unknown> | undefined)?.m3 as Record<string, unknown> | undefined;
    const matching = (m3?.material_matching ?? []) as Array<Record<string, unknown>>;
    const reviews: MatchingReview[] = [];
    for (const audit of matching) {
      const source = (audit.source_material ?? {}) as { material_code?: string; material_name?: string };
      const deterministic = (audit.deterministic_result ?? {}) as { status?: string; candidates?: Array<Record<string, unknown>> };
      if (String(deterministic.status ?? '') !== 'review_required') continue;
      const candidates = deterministic.candidates ?? [];
      const allCandidates: MatchingCandidate[] = candidates
        .map((candidate) => ({
          material_code:
            ((candidate.erp_material ?? {}) as { material_code?: string }).material_code
            ?? (candidate.material_code as string | undefined)
            ?? '',
          material_name:
            ((candidate.erp_material ?? {}) as { material_name?: string }).material_name
            ?? '',
          score: typeof candidate.score === 'number' ? candidate.score : undefined,
          conflicts: String(candidate.conflicts ?? ''),
        }))
        .filter((candidate) => Boolean(candidate.material_code));
      const best = candidates.find((candidate) => !String(candidate.conflicts ?? '').includes('unit_dimension')) ?? candidates[0];
      const erp = ((best?.erp_material ?? {}) as { material_code?: string }).material_code ?? (best?.material_code as string | undefined);
      if (source.material_code) {
        reviews.push({
          material_code: source.material_code,
          material_name: source.material_name ?? source.material_code,
          candidateCode: erp,
          candidateScore: typeof best?.score === 'number' ? best.score : undefined,
          candidates: allCandidates,
        });
      }
    }
    return reviews;
  }, [run]);

  const m1OrderLines = useMemo<M1OrderLine[]>(() => {
    const envelope = (run?.results as Record<string, unknown> | undefined)?.m1 as Record<string, unknown> | undefined;
    const m1 = (
      envelope?.data && typeof envelope.data === 'object'
        ? envelope.data
        : envelope
    ) as Record<string, unknown> | undefined;
    const document = (m1?.document ?? m1) as { lines?: M1OrderLine[]; bom?: M1OrderLine[] } | undefined;
    const lines = document?.lines ?? document?.bom ?? [];
    return Array.isArray(lines) ? lines : [];
  }, [run]);
  const m1HasRecognizedQuantity = m1OrderLines.some((line) => hasPositiveQuantity(line.quantity));
  const m1HasSupplementedQuantity = hasPositiveQuantity(m1Review.order_qty);
  const m1QuantityRequired = !m1HasRecognizedQuantity;

  const isM5Gate =
    (phase === 'human_input_required' || phase === 'blocked') &&
    /(M5|capacity facts|routings|resources)/i.test(detail ?? '');
  const isM1Gate =
    phase === 'human_input_required' &&
    /(M1|order facts|M0.*(?:订单|order).*(?:解析|parse))/i.test(detail ?? '');
  const m1OrderIdentityRequired = isM1Gate && (
    (missingDocuments ?? []).some((item) =>
      String(item.field ?? '').trim() === 'm1_review_overrides.order_id')
    || /M1\s*订单身份(?:缺失|冲突)/i.test(detail ?? '')
  );
  const m1HasSupplementedOrderId = Boolean(String(m1Review.order_id ?? '').trim());
  const m1RequiredFieldsReady =
    (!m1QuantityRequired || m1HasSupplementedQuantity)
    && (!m1OrderIdentityRequired || m1HasSupplementedOrderId);
  const isM2Gate = /(M2)/i.test(detail ?? '') && phase === 'human_input_required';
  // M3 治理门：上游 BOM 未批准（draft），需人工审核批准 BOM 后才能正式释放 MRP/采购/排程
  const isBomApprovalGate =
    phase === 'human_input_required' &&
    /(governance|UPSTREAM_BOM_NOT_APPROVED|UPSTREAM_ENGINEERING|BOM_NOT_APPROVED|CANONICAL_PUBLICATION)/i.test(detail ?? '');
  // M3 物料计划需人工确认：M3 阶段、非 BOM 批准门、且无待核验匹配、无缺料时展示
  // （对应 orchestrator 的 M3 物料计划/库存权威数据人工确认门）
  const isM3PlanGate =
    (phase === 'human_input_required' || phase === 'blocked') &&
    /(M3|material|mrp|procurement_plan|物料计划|权威数据)/i.test(detail ?? '') &&
    !isBomApprovalGate &&
    m3Matching.length === 0 &&
    shortages.length === 0;
  const isLegacyM3GateContext =
    phase === 'blocked' &&
    /(M3|material|mrp|shortage|物料|缺料)/i.test(detail ?? '');
  // M4 采购信息需人工确认：M4 阶段人工确认门
  const isM4Gate =
    (phase === 'human_input_required' || phase === 'blocked') &&
    /(M4|purchase|采购)/i.test(detail ?? '');
  const selectOrder = (catalogId: string) => {
    viewOrderRequestSequence.current += 1;
    setSelectedCatalogId(catalogId);
    localStorage.setItem(SELECTED_ORDER_KEY, catalogId);
    useBusinessRunStore.getState().setSelectedCatalogId(catalogId);
  };

  const beginMeta = useCallback((order: BusinessFlowOrder): BusinessRunMeta => ({
    orderId: order.orderId,
    productName: order.productName,
  }), []);

  const runOrder = async (order: BusinessFlowOrder) => {
    if (!canOperateBusinessFlow || store.running) return;
    const config = catalogConfigsQuery.data?.find((item) => item.catalog_id === order.catalogId);
    if (!config) {
      void message.warning('该订单缺少完整运行输入，只能查看');
      return;
    }
    const conversationId = currentConversationId();
    viewOrderRequestSequence.current += 1;
    store.begin(beginMeta(order), conversationId);
    const applyProgress = guardFlowUpdatesFor(conversationId, store.update);
    try {
      await runCatalogBusinessFlow(config, { onProgress: applyProgress });
    } catch (cause) {
      const isConflict = cause instanceof HttpClientError && cause.error?.status === 409;
      if (isConflict) {
        void message.info('检测到历史运行记录，已自动以新运行执行当前订单');
        try {
          await runCatalogBusinessFlowForce(config, { onProgress: applyProgress });
          return;
        } catch (forceCause) {
          const forceText = errorMessage(forceCause);
          applyProgress({ phase: 'failed', title: '业务流程运行失败', detail: forceText, failed: true, error: forceText });
          return;
        }
      }
      const text = errorMessage(cause);
      applyProgress({ phase: 'failed', title: '业务流程运行失败', detail: text, failed: true, error: text });
    }
  };

  const viewOrder = useCallback(async (order: BusinessFlowOrder) => {
    const requestSequence = ++viewOrderRequestSequence.current;
    const conversationId = currentConversationId();
    const isCurrentRequest = () => {
      const current = useBusinessRunStore.getState();
      return requestSequence === viewOrderRequestSequence.current
        && current.selectedCatalogId === order.catalogId
        && currentConversationId() === conversationId;
    };
    try {
      const traceData = await getBusinessOrderTrace(order.orderId);
      if (!isCurrentRequest()) return;
      useBusinessRunStore.getState().preview(traceData, beginMeta(order), undefined, conversationId);
    } catch (cause) {
      if (isCurrentRequest()) void message.error(errorMessage(cause));
    }
  }, [beginMeta]);

  useEffect(() => {
    if (pmcProgressRequest <= 0) return;
    setExpanded(true);
    if (!selectedOrder || lastPmcProgressRequest.current === pmcProgressRequest) {
      return;
    }
    lastPmcProgressRequest.current = pmcProgressRequest;
    void viewOrder(selectedOrder);
  }, [pmcProgressRequest, selectedOrder, viewOrder]);

  const submitAnswers = async () => {
    const current = useBusinessRunStore.getState();
    if (!canOperateBusinessFlow || !isRecoverableGateState(current.phase, current.run?.status) || !store.runId || busy) return;
    // 自然语言确认意见交由后端 Agent 解析；未提及的确认项由后端默认策略兜底。
    // 即使留空也提交 manual_message（空串），后端按全部默认规则处理。
    // 逐条选项选择（m2Choices）优先于 manual_message：明确到具体 field 的确认
    // 不会被自然语言覆盖，后端以结构化值精确消费。
    const customerAnswers: Record<string, string> = {
      ...m2Choices,
      manual_message: manualM2Note.trim(),
    };
    const applyProgress = guardFlowUpdatesFor(currentConversationId(), store.update);
    setBusy('m2');
    try {
      await resumeBusinessFlow(store.runId, {
        orderId,
        supplement: { m2_payload: { template_confirmation: { confirmed: true }, customer_answers: customerAnswers } },
        onProgress: applyProgress,
      });
    } catch (cause) {
      applyProgress({ phase: 'failed', title: '继续运行失败', detail: errorMessage(cause), failed: true, error: errorMessage(cause) });
    } finally {
      setBusy(undefined);
    }
  };

  // 审核并批准 BOM：人工核对 M2 草稿后提交受权限控制的审批命令。
  // 后端把审批绑定到当前 TaskID 和候选 BOM 摘要，再发布 M0 canonical BOM。
  const approveBomAndContinue = async () => {
    const current = useBusinessRunStore.getState();
    if (!canApproveBom || !isRecoverableGateState(current.phase, current.run?.status) || !store.runId || busy) return;
    const applyProgress = guardFlowUpdatesFor(currentConversationId(), store.update);
    setBusy('bom-approve');
    try {
      await resumeBusinessFlow(store.runId, {
        orderId,
        action: 'approve_bom_for_m0_publication',
        onProgress: applyProgress,
      });
    } catch (cause) {
      applyProgress({ phase: 'failed', title: '批准 BOM 继续失败', detail: errorMessage(cause), failed: true, error: errorMessage(cause) });
    } finally {
      setBusy(undefined);
    }
  };

  const submitRestock = async () => {
    const current = useBusinessRunStore.getState();
    if (!canOperateBusinessFlow || !isRecoverableGateState(current.phase, current.run?.status) || !store.runId || busy) return;
    const restockQty = (item: ShortageRow) =>
      Number(restock[item.material_code] ?? item.suggest_purchase_qty ?? item.shortage_qty ?? 0);
    const rows = shortages
      .filter((item) => restockQty(item) > 0)
      .map((item) => ({
        material_code: item.material_code,
        material_name: item.material_name ?? '',
        warehouse: '材料仓',
        lot_no: `RESTOCK-${Date.now()}-${item.material_code}`,
        available_qty: restockQty(item),
        locked_qty: 0,
        qc_status: 'passed',
        received_at: new Date().toISOString().slice(0, 10),
        base_stock_reserved: 0,
        uom: item.uom ?? '',
      }));
    if (!rows.length) {
      void message.warning('请填写至少一项补货数量后再继续');
      return;
    }
    const withRequest = run as BusinessFlowRun & { request?: { m3_payload?: { inventory_snapshot?: unknown[] } } };
    const original = withRequest.request?.m3_payload?.inventory_snapshot ?? [];
    const applyProgress = guardFlowUpdatesFor(currentConversationId(), store.update);
    setBusy('m3');
    try {
      const requestWithProject = run as BusinessFlowRun & { request?: { m3_payload?: { order?: { project_id?: string } } } };
      const m3Result = (run?.results as Record<string, unknown> | undefined)?.m3 as
        | { data?: { project_id?: string } }
        | undefined;
      const projectId =
        requestWithProject.request?.m3_payload?.order?.project_id
        ?? m3Result?.data?.project_id
        ?? '';
      if (projectId) {
        try {
          await requestJson('/m3/supply/restock', {
            method: 'POST',
            body: { project_id: projectId, rows },
          });
        } catch (cause) {
          if (run?.mode === 'real') {
            throw new Error(`补货入账失败：${errorMessage(cause)}`);
          }
        }
      } else if (run?.mode === 'real') {
        throw new Error('补货入账失败：当前 M3 计划缺少 project_id');
      }
      await resumeBusinessFlow(store.runId, {
        orderId,
        supplement: { m3_payload: { inventory_snapshot: [...original, ...rows] } },
        onProgress: applyProgress,
      });
    } catch (cause) {
      applyProgress({ phase: 'failed', title: '继续运行失败', detail: errorMessage(cause), failed: true, error: errorMessage(cause) });
    } finally {
      setBusy(undefined);
    }
  };

  const submitMatchingReview = async () => {
    const current = useBusinessRunStore.getState();
    if (!canOperateBusinessFlow || !isRecoverableGateState(current.phase, current.run?.status) || !store.runId || busy) return;
    const overrides: Record<string, { source_material_code: string; expected_erp_material_code: string }> = {};
    for (const item of m3Matching) {
      if (item.candidateCode) {
        overrides[item.material_code] = {
          source_material_code: item.material_code,
          expected_erp_material_code: item.candidateCode,
        };
      }
    }
    if (!Object.keys(overrides).length) {
      void message.warning('没有可采用的最高匹配候选');
      return;
    }
    const applyProgress = guardFlowUpdatesFor(currentConversationId(), store.update);
    setBusy('m3-review');
    try {
      await resumeBusinessFlow(store.runId, {
        orderId,
        ...(exceptionGate
          ? {
              action: 'allow' as const,
              gateCode: exceptionGate.gateCode,
              evidenceDigest: exceptionGate.evidenceDigest,
            }
          : {}),
        supplement: { m3_payload: { material_matching_overrides: overrides } },
        onProgress: applyProgress,
      });
    } catch (cause) {
      applyProgress({ phase: 'failed', title: '物料匹配核验继续失败', detail: errorMessage(cause), failed: true, error: errorMessage(cause) });
    } finally {
      setBusy(undefined);
    }
  };

  const decideExceptionGate = async (action: 'allow' | 'reject') => {
    const current = useBusinessRunStore.getState();
    if (!exceptionGate || !store.runId || busy || !canOperateBusinessFlow) return;
    if (isBomPublicationExceptionGate && action === 'allow' && !canApproveBom) {
      void message.error('当前账号没有 BOM 批准权限');
      return;
    }
    if (!isRecoverableGateState(current.phase, current.run?.status)) return;
    const applyProgress = guardFlowUpdatesFor(currentConversationId(), store.update);
    setBusy(`gate-${action}`);
    try {
      const supplement = exceptionGate.gateCode === 'm2_bom_resolution'
        ? {
            m2_payload: {
              template_confirmation: { confirmed: true },
              customer_answers: { ...m2Choices, manual_message: manualM2Note.trim() },
            },
          }
        : undefined;
      await resumeBusinessFlow(store.runId, {
        orderId,
        action,
        gateCode: exceptionGate.gateCode,
        evidenceDigest: exceptionGate.evidenceDigest,
        supplement,
        comment: supplementGateNote.trim() || supplementBomNote.trim() || undefined,
        onProgress: applyProgress,
      });
    } catch (cause) {
      applyProgress({
        phase: 'failed',
        title: action === 'allow' ? '允许继续失败' : '拒绝操作失败',
        detail: errorMessage(cause),
        failed: true,
        error: errorMessage(cause),
      });
    } finally {
      setBusy(undefined);
    }
  };

  const submitSimulatedProcurementReceipt = async () => {
    if (!store.runId || busy || !canOperateBusinessFlow || !canConfirmSimulatedProcurement) return;
    const applyProgress = guardFlowUpdatesFor(currentConversationId(), store.update);
    setBusy('simulated-procurement');
    try {
      await resumeBusinessFlow(store.runId, {
        orderId,
        action: 'confirm_simulated_procurement_received',
        ...(exceptionGate?.gateCode === 'm3_material_shortage'
          ? {
              gateCode: exceptionGate.gateCode,
              evidenceDigest: exceptionGate.evidenceDigest,
            }
          : {}),
        comment: `人工确认本 TaskID 的 ${shortages.length} 项采购全部模拟到货`,
        onProgress: applyProgress,
      });
    } catch (cause) {
      applyProgress({
        phase: 'failed',
        title: '模拟到货继续失败',
        detail: errorMessage(cause),
        failed: true,
        error: errorMessage(cause),
      });
    } finally {
      setBusy(undefined);
    }
  };

  const pauseExceptionGate = () => {
    if (!exceptionGate) return;
    if (exceptionGate.gateCode === 'm3_material_matching') {
      setManualMatchingOpen(true);
      return;
    }
    setExceptionEditorOpen(true);
  };

  const submitManualMatching = async () => {
    const current = useBusinessRunStore.getState();
    if (!canOperateBusinessFlow || !isRecoverableGateState(current.phase, current.run?.status) || !store.runId || busy) return;
    const overrides: Record<string, { source_material_code: string; expected_erp_material_code: string }> = {};
    for (const item of m3Matching) {
      const chosen = (manualCustom[item.material_code] ?? '').trim() || manualChoices[item.material_code] || item.candidateCode;
      if (chosen) {
        overrides[item.material_code] = {
          source_material_code: item.material_code,
          expected_erp_material_code: chosen,
        };
      }
    }
    if (!Object.keys(overrides).length) {
      void message.warning('请至少为一个物料选择匹配项');
      return;
    }
    const applyProgress = guardFlowUpdatesFor(currentConversationId(), store.update);
    setBusy('m3-review');
    try {
      await resumeBusinessFlow(store.runId, {
        orderId,
        ...(exceptionGate
          ? {
              action: 'allow' as const,
              gateCode: exceptionGate.gateCode,
              evidenceDigest: exceptionGate.evidenceDigest,
            }
          : {}),
        supplement: { m3_payload: { material_matching_overrides: overrides } },
        onProgress: applyProgress,
      });
      setManualMatchingOpen(false);
    } catch (cause) {
      applyProgress({ phase: 'failed', title: '人工匹配继续失败', detail: errorMessage(cause), failed: true, error: errorMessage(cause) });
    } finally {
      setBusy(undefined);
    }
  };

  const loadM5Fixture = async () => {
    const current = useBusinessRunStore.getState();
    if (!canLoadM5Fixture || !isRecoverableGateState(current.phase, current.run?.status) || !store.runId || !store.taskId || busy) return;
    const applyProgress = guardFlowUpdatesFor(currentConversationId(), store.update);
    setBusy('m5');
    try {
      const reqOrderId = String(run?.requested_order_id ?? orderId ?? '');
      // 受控 fixture 只用于打通页面和求解技术链。即使原运行是 real，
      // 也只能单向降级为 pressure_only，不能产生审批、发布或生产事实。
      await resumeBusinessFlow(store.runId, {
        orderId: reqOrderId,
        supplement: { m5_payload: { scenario_purpose: 'pressure_only', fixture: 'standard-4station' } },
        onProgress: applyProgress,
      });
      store.markM5FixtureLoaded();
    } catch (cause) {
      applyProgress({ phase: 'failed', title: '受控排程生成失败', detail: errorMessage(cause), failed: true, error: errorMessage(cause) });
    } finally {
      setBusy(undefined);
    }
  };

  const continueRun = async () => {
    const current = useBusinessRunStore.getState();
    if (!canOperateBusinessFlow || !isRecoverableGateState(current.phase, current.run?.status) || !store.runId || busy) return;
    const applyProgress = guardFlowUpdatesFor(currentConversationId(), store.update);
    setBusy('resume');
    try {
      await resumeBusinessFlow(store.runId, {
        orderId,
        supplement: { m2_payload: { template_confirmation: { confirmed: true } } },
        onProgress: applyProgress,
      });
    } catch (cause) {
      applyProgress({ phase: 'failed', title: '继续运行失败', detail: errorMessage(cause), failed: true, error: errorMessage(cause) });
    } finally {
      setBusy(undefined);
    }
  };

  // M3 物料计划 / M4 采购信息人工确认：确认继续或携带本节点补充说明恢复同一受治理流程。
  const resumeGateWithComment = async () => {
    if (!store.runId || busy) return;
    const applyProgress = guardFlowUpdatesFor(currentConversationId(), store.update);
    setBusy('gate-confirm');
    try {
      await resumeBusinessFlow(store.runId, {
        orderId,
        comment: supplementGateNote.trim().length > 0 ? supplementGateNote.trim() : undefined,
        onProgress: applyProgress,
      });
    } catch (cause) {
      applyProgress({ phase: 'failed', title: '恢复受治理流程失败', detail: errorMessage(cause), failed: true, error: errorMessage(cause) });
    } finally {
      setBusy(undefined);
    }
  };

  // 退出受治理流程：清空本地人工门表单并重置面板（对应 hejiawei 的人工门三按钮「退出」）。
  const exitGate = () => {
    setManualM2Note('');
    setSupplementBomNote('');
    setSupplementGateNote('');
    setM2Choices({});
    setM1Review({});
    setRestock({});
    setManualChoices({});
    setManualCustom({});
    setManualMatchingOpen(false);
    setPreview(null);
    setBusy(undefined);
    store.reset();
  };

  // M1 人工复核确认：接受当前识别结果（订单文件已在上一次 run 持久化，resume 不再重跑 M1 识别），
  // 若人工在复核表单修正/补充了字段（m1Review），随 supplement 提交给后端；
  // 未填写任何修正则不带 supplement 直接续跑 M2-M5。
  const confirmM1AndContinue = async () => {
    const current = useBusinessRunStore.getState();
    const currentRunId = current.runId ?? current.run?.run_id;
    if (!canOperateBusinessFlow || !isRecoverableGateState(current.phase, current.run?.status) || !currentRunId) {
      void message.warning('流程状态已变化，请从 Agent 任务中重新定位后继续');
      return;
    }
    if (busy) return;
    if (m1QuantityRequired && !m1HasSupplementedQuantity) {
      void message.warning('请补充大于 0 的订单数量后继续');
      return;
    }
    if (m1OrderIdentityRequired && !m1HasSupplementedOrderId) {
      void message.warning('请补充订单号后继续');
      return;
    }
    const applyProgress = guardFlowUpdatesFor(currentConversationId(), store.update);
    setBusy('m1');
    const filled = Object.fromEntries(
      Object.entries(m1Review).filter(([, value]) => String(value ?? '').trim() !== ''),
    );
    try {
      await resumeBusinessFlow(currentRunId, {
        orderId,
        supplement: Object.keys(filled).length
          ? { m1_review_overrides: filled }
          : undefined,
        onProgress: applyProgress,
      });
    } catch (cause) {
      applyProgress({ phase: 'failed', title: '继续运行失败', detail: errorMessage(cause), failed: true, error: errorMessage(cause) });
    } finally {
      setBusy(undefined);
    }
  };

  const selectOptions = ordersQuery.data?.map((order) => ({
    value: order.catalogId,
    label: `${order.orderId} · ${order.productName}`,
  })) ?? [];
  const isPreview = store.active && !store.running && phase === undefined;
  const phaseLabel = m5FixtureLoaded ? '演示完成（非生产）' : isCompleted ? '已完成' : isFailed ? '失败' : showAttention ? '需人工' : store.running ? '运行中' : store.active ? '预览' : undefined;
  const phaseColor = m5FixtureLoaded ? 'warning' : isCompleted ? 'success' : isFailed ? 'error' : showAttention ? 'warning' : store.running ? 'processing' : isPreview ? 'cyan' : undefined;

  return (
    <section ref={panelRef} className="data-flow-panel" aria-label="订单业务流程">
      {!readOnly ? <UploadContextBar /> : null}
      <div className={styles.context}>
        <div className={styles.contextMain}>
          <div className={styles.contextTitle}>订单流程</div>
          <Select
            aria-label="选择业务订单"
            className={styles.contextSelect}
            showSearch
            optionFilterProp="label"
            loading={ordersQuery.isLoading}
            status={ordersQuery.isError ? 'error' : undefined}
            placeholder={ordersQuery.isError ? '订单数据暂不可用' : '选择订单'}
            options={selectOptions}
            value={selectedOrder?.catalogId}
            onChange={selectOrder}
          />
          {phaseLabel ? <Tag color={phaseColor} icon={isPreview ? <EyeOutlined /> : undefined}>{phaseLabel}</Tag> : null}
          {m5FixtureLoaded ? <Tag color="gold">受控 fixture · pressure_only · 不可审批/发布/派工</Tag> : null}
        </div>
        <Space size={8} className={styles.contextActions}>
          {!readOnly ? (
            <FlowActionGate targetId={`run:${selectedOrder?.catalogId ?? 'unselected'}`}>
              <Button
                type="primary"
                size="small"
                icon={<PlayCircleOutlined />}
                title={selectedOrder?.runnable ? '在本页执行所选订单的 订单到排程，不跳转业务页' : '该订单缺少完整运行输入'}
                disabled={!selectedOrder?.runnable || store.running}
                loading={busy === 'run'}
                onClick={() => selectedOrder && void runOrder(selectedOrder)}
              >
                {store.running ? '运行中' : '运行'}
              </Button>
            </FlowActionGate>
          ) : null}
          <Button size="small" icon={<EyeOutlined />} disabled={!selectedOrder} onClick={() => selectedOrder && void viewOrder(selectedOrder)}>
            查看
          </Button>
          <Button size="small" type="text" icon={<DownOutlined rotate={expanded || showAttention ? 180 : 0} />}
            aria-label={expanded || showAttention ? '收起订单流程大屏' : '展开订单流程大屏'}
            aria-controls="data-flow-overlay"
            aria-expanded={expanded || showAttention}
            disabled={showAttention}
            onClick={() => setExpanded((value) => !value)} />
        </Space>
      </div>

      {/* 需人工/阻断/失败时始终展开大屏，确认卡不因折叠而不可见 */}
      {expanded || showAttention ? (
        <div
          ref={overlayRef}
          id="data-flow-overlay"
          className={styles.overlay}
          data-testid="data-flow-overlay"
          role="region"
          aria-label="订单流程详情"
        >
          <div className={styles.flowTrack} aria-label="订单到排程 数据流动">
            {STAGES.map((stage, index) => {
              const status = statuses[index] ?? 'idle';
              return (
                <div className={styles.stageWrap} key={stage.id}>
                  <button
                    type="button"
                    className={`${styles.stageCard} ${status === 'data' ? styles['is-data-only'] : styles[`is-${status}`]}`}
                    aria-label={`查看 ${stage.id.toUpperCase()} ${readOnly ? '流程任务' : 'Agent 任务'}`}
                    onClick={() => window.dispatchEvent(
                      new CustomEvent<AgentCode>('yunpai:open-agent-tasks', { detail: stage.id }),
                    )}
                  >
                    <Badge
                      className={styles.stageTaskBadge}
                      count={agentTaskCounts[stage.id]}
                      size="small"
                      overflowCount={99}
                    />
                    <span className={styles.stageIcon} aria-hidden="true">{stage.icon}</span>
                    <div className={styles.stageBody}>
                      <div className={styles.stageHead}>
                        <b>{stage.id.toUpperCase()}</b>
                        <small>{stage.name}</small>
                      </div>
                      {statusTag(status)}
                    </div>
                    <span className={styles.stageSummary}>{stageSummary(stage.id, trace, run)}</span>
                  </button>
              {index < STAGES.length - 1 ? (
                <div
                  className={`${styles.connector} ${status === 'running' ? styles.isFlowing : status === 'ok' ? styles.isDone : status === 'attention' ? styles.isWaiting : ''}`}
                  aria-hidden="true"
                >
                  <i />
                </div>
              ) : null}
                </div>
              );
            })}
          </div>

          {!store.active ? (
            <div className={styles.emptyHint}>
              {readOnly
                ? '选择订单或从任务提醒定位，这里实时展示 订单到排程 数据流动'
                : '选择订单或上传文件，这里实时展示 订单到排程 数据流动'}
            </div>
          ) : null}

          {store.active && !showAttention ? (
            <div className={`${styles.statusLine} ${phase === 'done' || m5FixtureLoaded ? styles.isDone : ''}`}>
              <span className={styles.statusText}>
                {isPreview ? <EyeOutlined /> : m5FixtureLoaded ? <CheckCircleOutlined /> : phase === 'done' ? <CheckCircleOutlined /> : <LoadingOutlined />}
                {title ?? '准备运行'}
              </span>
              <span className={styles.statusDetail}>{detail}</span>
              <TaskId value={store.taskId} />
              {m5FixtureLoaded || phase === 'done' ? (
              <span className={styles.statusNumbers}>
                  {trace ? `${activeMaterials(trace).length} 种物料 · ${trace.procurement_plan_lines.length} 条采购建议${trace.schedule_versions.at(-1) ? ' · 排程已生成' : ''}` : ''}
                </span>
              ) : null}
            </div>
          ) : null}

          {planVersion || pmcProgressRequest > 0 ? (
            <M5ScheduleSummary
              schedule={pmcQuery.data}
              loading={pmcQuery.isFetching}
              catalogId={selectedOrder?.catalogId}
              planVersion={planVersion}
              simulatedProcurement={hasSimulatedProcurementReceipt}
              simulatedEngineeringRoute={hasSimulatedEngineeringRouteReceipt}
            />
          ) : null}

          {showHistoricalScheduleNotice ? (
            <Alert
              data-testid="historical-pmc-notice"
              type="info"
              showIcon
              message="本次任务未生成 PMC"
              description={`该订单存在历史排程 ${historicalPlanVersion}，未计入本次任务。`}
            />
          ) : null}

          {showAttention ? (
            <div className={styles.attention}>
              <Collapse
                ghost
                className={styles.attentionCollapse}
                items={[
                  {
                    key: 'attention',
                    label: (
                      <span className={styles.attentionCollapseLabel}>
                        <Tag color={isFailed ? 'error' : 'warning'}>{isFailed ? '链路停在真实失败步骤' : '链路已安全暂停'}</Tag>
                        <span className={styles.attentionTitle}>{title}</span>
                        <span className={styles.attentionCollapseHint}>点击查看详情</span>
                      </span>
                    ),
                    children: (
                      <div className={styles.attentionCollapseBody}>
                        <div className={styles.attentionDetail}>{detail}</div>
                        <TaskId value={store.taskId} />
                        {runError ? <div className={styles.gateErrorBlock}>⚠ {runError}</div> : null}
                        {Array.isArray(missingDocuments) && missingDocuments.length ? (
                          <div className={styles.missingDocsBlock}>
                            <div className={styles.gateLabel}>缺少以下资料，可上传基础数据经 M0 识别后自动继续：</div>
                            <div className={styles.gateCandidates}>
                              {missingDocuments.map((doc, index) => {
                                const module = String(doc?.module ?? '?');
                                const fileType = String(doc?.file_type ?? '');
                                const hint = String(doc?.file_type_hint ?? doc?.reason ?? '');
                                const moduleColor: Record<string, string> = { m1: 'blue', m2: 'orange', m3: 'purple', m4: 'cyan', m5: 'geekblue' };
                                return (
                                  <div className={styles.gateCandidateItem} key={`${module}-${fileType}-${index}`}>
                                    <Tag color={moduleColor[module] ?? 'default'}>{module.toUpperCase()}</Tag>
                                    {hint || fileType}
                                  </div>
                                );
                              })}
                            </div>
                            {!readOnly && canOperateGate ? (
                              <FlowActionGate targetId={`${store.runId ?? 'unknown'}:open-m0-upload`}>
                                <Button
                                  size="small"
                                  type="primary"
                                  ghost
                                  icon={<CloudUploadOutlined />}
                                  onClick={() => window.dispatchEvent(new Event('yunpai:open-m0-upload'))}
                                >
                                  上传基础资料（历史 BOM/SOP/工艺/物料/设备）
                                </Button>
                              </FlowActionGate>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ),
                  },
                ]}
              />
              {readOnly ? (
                <Alert
                  type="info"
                  showIcon
                  message="品保监督模式为只读"
                  description="可查看流程暂停、异常与缺失资料，但不能在此运行订单或提交人工门操作。"
                />
              ) : (
                <>
              {canOperateGate && phase === 'data_incomplete' && !isSimulatedEngineeringRouteGate ? (
                <div className={styles.gateCard}>
                  <b>数据未完善</b>
                  <div className={styles.gateLabel}>
                    流程安全停在可恢复节点：当前缺少权威数据/接口，未产生任何正式排程、审批或派工副作用。
                    补齐下列缺失数据后，可点击「继续运行」同 TaskID 恢复。
                  </div>
                  {Array.isArray(missing) && missing.length ? (
                    <div className={styles.gateRowColumn}>
                      {missing.map((item, index) => {
                        const module = String(item?.module ?? '?');
                        const capability = String(item?.capability ?? item?.field ?? '未注明');
                        const owner = String(item?.owner ?? module);
                        const resumeFrom = String(item?.resume_from ?? run?.current_node ?? '当前节点');
                        const reason = String(item?.reason ?? '');
                        const fields = Array.isArray(item?.fields) ? item.fields.map(String).join('、') : '';
                        return (
                          <div className={styles.gateCandidateItem} key={`${module}-${capability}-${index}`}>
                            缺失模块 {module} · 能力 {capability}
                            {fields ? ` · 字段 ${fields}` : ''}
                            {' · '}责任方 {owner} · 恢复节点 {resumeFrom}
                            {reason ? ` · 原因 ${reason}` : ''}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className={styles.gateHint}>缺失明细由服务端返回，当前未提供。</div>
                  )}
                  <div className={styles.gateHint}>
                    真实数据补齐前不会补造默认库存/生产单元；如需演示后续页面，请使用显式受控演示入口（非生产数据，不可审批/发布）。
                  </div>
                  <FlowActionGate targetId={`${store.runId ?? 'unknown'}:resume-data-incomplete`}>
                    <Button
                      type="primary"
                      icon={<PlayCircleOutlined />}
                      loading={busy === 'resume'}
                      onClick={() => void continueRun()}
                    >
                      数据补齐后重试
                    </Button>
                  </FlowActionGate>
                </div>
              ) : null}
              {canOperateGate && exceptionGate ? (
                <div className={styles.exceptionGate} data-testid="exception-decision-gate">
                  <div className={styles.exceptionGateHead}>
                    <div>
                      <b>{exceptionGate.title}</b>
                      <div className={styles.exceptionGateSummary}>{exceptionGate.evidenceSummary}</div>
                    </div>
                    <Tag color={exceptionGate.severity === 'critical' ? 'red' : 'orange'}>异常待决策</Tag>
                  </div>
                  {isSimulatedEngineeringRouteGate ? (
                    <div className={styles.gateCard} data-testid="simulated-engineering-route-gate">
                      <b>模拟工艺闭环</b>
                      <div className={styles.gateLabel}>
                        当前订单、数量、交期和 BOM 已存在，仅缺少可匹配的已发布工艺。
                        允许后将使用通用模拟工艺继续生成本 TaskID 的 PMC。
                      </div>
                      <div className={styles.gateHint}>
                        不写 M2 工艺主数据或生产单元映射；生成的 PMC 固定不可发布、不可派工。
                      </div>
                    </div>
                  ) : null}
                  {isBomPublicationExceptionGate ? (
                    bomApprovalLines.length ? (
                      <div className={styles.gateRowColumn} data-testid="bom-publication-preview">
                        <div className={styles.gatePreviewRow}>
                          <div className={styles.gateLabel}>待批准 BOM 明细（{bomApprovalLines.length} 行）：</div>
                          <Button
                            size="small"
                            type="link"
                            icon={<EyeOutlined />}
                            onClick={() =>
                              setPreview({
                                title: `待批准 BOM 明细（${bomApprovalLines.length} 行）`,
                                columns: [
                                  { key: 'code', title: '物料编码' },
                                  { key: 'name', title: '名称' },
                                  { key: 'qty', title: '用量' },
                                  { key: 'uom', title: '单位' },
                                  { key: 'scrap', title: '损耗%' },
                                  { key: 'supply', title: '类型' },
                                ],
                                rows: bomApprovalLines.map((line) => ({
                                  code: line.component_item ?? 'TBD',
                                  name: line.component_name ?? '',
                                  qty: line.qty_per != null ? String(line.qty_per) : '',
                                  uom: line.uom ?? '',
                                  scrap: line.scrap_pct != null ? String(line.scrap_pct) : '',
                                  supply: line.supply_type ?? '',
                                })),
                              })
                            }
                          >
                            预览全部 BOM 明细
                          </Button>
                        </div>
                        <div className={styles.gateCandidates}>
                          {bomApprovalLines.slice(0, 10).map((line, index) => (
                            <div className={styles.gateCandidateItem} key={`${line.component_item ?? 'line'}-${index}`}>
                              {line.component_item ?? 'TBD'} {line.component_name ?? ''}
                              {line.qty_per != null ? ` · 用量 ${String(line.qty_per)}` : ''}
                              {line.uom ? ` ${line.uom}` : ''}
                              {line.scrap_pct != null ? ` · 损耗 ${String(line.scrap_pct)}` : ''}
                              {line.supply_type ? ` · ${line.supply_type}` : ''}
                            </div>
                          ))}
                          {bomApprovalLines.length > 10 ? (
                            <div className={styles.gateCandidateItem}>
                              …共 {bomApprovalLines.length} 行，点「预览全部 BOM 明细」查看
                            </div>
                          ) : null}
                        </div>
                        <div className={styles.gateHint}>请核对物料编码、名称、用量、单位、损耗和供料类型后再做决定。</div>
                      </div>
                    ) : (
                      <Alert
                        type="error"
                        showIcon
                        message="当前没有可预览的 BOM 明细，不能批准发布"
                        description="请先暂停修改并补齐权威 BOM 数据。"
                      />
                    )
                  ) : null}
                  {exceptionEditorOpen ? (
                    <div className={styles.exceptionGateEditor}>
                      {exceptionGate.gateCode === 'm2_bom_resolution' ? (
                        <Input.TextArea
                          value={manualM2Note}
                          placeholder="仅填写需要改动的 BOM 处理意见"
                          autoSize={{ minRows: 2, maxRows: 4 }}
                          onChange={(event) => setManualM2Note(event.target.value)}
                        />
                      ) : isBomPublicationExceptionGate ? (
                        <Input.TextArea
                          value={supplementBomNote}
                          placeholder="仅填写需要改动的 BOM 审核意见"
                          autoSize={{ minRows: 2, maxRows: 4 }}
                          onChange={(event) => setSupplementBomNote(event.target.value)}
                        />
                      ) : (
                        <Input.TextArea
                          value={supplementGateNote}
                          placeholder="仅填写需要修改的处理意见"
                          autoSize={{ minRows: 2, maxRows: 4 }}
                          onChange={(event) => setSupplementGateNote(event.target.value)}
                        />
                      )}
                    </div>
                  ) : null}
                  <FlowActionGate
                    targetId={`${store.runId ?? 'unknown'}:${exceptionGate.gateCode}`}
                    permission={
                      isBomPublicationExceptionGate
                        ? 'm0:bom:approve'
                        : isSimulatedEngineeringRouteGate
                          ? 'schedule:write'
                          : 'm4:operate'
                    }
                  >
                    <Space wrap className={styles.exceptionGateActions}>
                      {exceptionGate.allowedActions.includes('allow') ? (
                        <Button
                          type="primary"
                          icon={<PlayCircleOutlined />}
                          loading={busy === 'gate-allow'}
                          disabled={
                            Boolean(busy && busy !== 'gate-allow')
                            || (isBomPublicationExceptionGate && !bomApprovalLines.length)
                          }
                          onClick={() => void decideExceptionGate('allow')}
                        >
                          允许
                        </Button>
                      ) : null}
                      {exceptionGate.allowedActions.includes('reject') ? (
                        <Button
                          danger
                          icon={<CloseCircleOutlined />}
                          loading={busy === 'gate-reject'}
                          disabled={Boolean(busy && busy !== 'gate-reject')}
                          onClick={() => void decideExceptionGate('reject')}
                        >
                          拒绝
                        </Button>
                      ) : null}
                      {exceptionGate.allowedActions.includes('pause_modify') ? (
                        <Button
                          icon={<PauseCircleOutlined />}
                          disabled={Boolean(busy)}
                          onClick={pauseExceptionGate}
                        >
                          暂停修改
                        </Button>
                      ) : null}
                    </Space>
                  </FlowActionGate>
                </div>
              ) : null}
              {canConfirmSimulatedProcurement ? (
                <div className={styles.gateCard} data-testid="simulated-procurement-gate">
                  <b>模拟采购闭环</b>
                  <div className={styles.gateLabel}>
                    当前订单仍有 {shortages.length} 项缺料。确认后仅把本 TaskID 视为全部到货，并继续生成模拟 PMC。
                  </div>
                  <div className={styles.gateHint}>不写库存、不修改 M4；生成的 PMC 不可发布或派工。</div>
                  <FlowActionGate targetId={`${store.runId ?? 'unknown'}:simulated-procurement`}>
                    <Button
                      type="primary"
                      icon={<ShoppingCartOutlined />}
                      loading={busy === 'simulated-procurement'}
                      disabled={Boolean(busy && busy !== 'simulated-procurement')}
                      onClick={() => void submitSimulatedProcurementReceipt()}
                    >
                      确认模拟采购已到货并继续
                    </Button>
                  </FlowActionGate>
                </div>
              ) : null}
              {canOperateGate && phase !== 'data_incomplete' && !exceptionGate && !isM1Gate ? (
                <div className={styles.attentionActions}>
                  <FlowActionGate targetId={`${store.runId ?? 'unknown'}:resume`}>
                    <Button icon={<PlayCircleOutlined />} loading={busy === 'resume'} onClick={() => void continueRun()}>继续运行</Button>
                  </FlowActionGate>
                </div>
              ) : null}
              {canOperateGate && isM1Gate ? (
                <div className={styles.gateCard}>
                  <b>M0 订单解析需人工复核</b>
                  {m1OrderLines.length ? (
                    <div className={styles.gateRowColumn}>
                      <div className={styles.gatePreviewRow}>
                        <div className={styles.gateLabel}>识别到的订单明细（{m1OrderLines.length} 行）：</div>
                        <Button
                          size="small"
                          type="link"
                          icon={<EyeOutlined />}
                          onClick={() =>
                            setPreview({
                              title: `M1 识别订单明细（${m1OrderLines.length} 行）`,
                              columns: [
                                { key: 'name', title: '名称' },
                                { key: 'model', title: '型号/编号' },
                                { key: 'qty', title: '数量' },
                                { key: 'uom', title: '单位' },
                              ],
                              rows: m1OrderLines.map((line) => ({
                                name: line.name_raw ?? line.product_name ?? line.name ?? '',
                                model: line.model ?? line.product_code ?? '',
                                qty: line.quantity != null ? String(line.quantity) : '',
                                uom: line.uom ?? '',
                              })),
                            })
                          }
                        >
                          预览全部明细
                        </Button>
                      </div>
                      <div className={styles.gateCandidates}>
                        {m1OrderLines.slice(0, 5).map((line, index) => {
                          const name = line.name_raw ?? line.product_name ?? line.name ?? '';
                          const model = line.model ?? line.product_code ?? '';
                          const qty = line.quantity != null ? `× ${line.quantity}` : '';
                          const uom = line.uom ?? '';
                          return (
                            <div className={styles.gateCandidateItem} key={`${name ?? 'line'}-${index}`}>
                              {name} {model ? `(${model})` : ''} {qty} {uom}
                            </div>
                          );
                        })}
                        {m1OrderLines.length > 5 ? <div className={styles.gateCandidateItem}>…共 {m1OrderLines.length} 行，点「预览全部明细」查看</div> : null}
                      </div>
                    </div>
                  ) : (
                    <div className={styles.gateHint}>未取到订单明细，请人工核对上传文件后继续。</div>
                  )}
                  <div className={styles.gateHint}>
                    {m1QuantityRequired && m1OrderIdentityRequired
                      ? '未识别到订单数量和唯一订单号，请在下方补充后继续。'
                      : m1QuantityRequired
                      ? '未识别到订单数量，请在下方补充大于 0 的数量后继续。'
                      : m1OrderIdentityRequired
                        ? '订单身份缺失或存在冲突，请在下方确认订单号后继续。'
                      : '识别结果字段不完整或置信度不足，可在下方修正后继续；留空则按识别结果继续 M2-M5。'}
                  </div>
                  <div className={styles.gateRowColumn}>
                    <div className={styles.gateLabel}>人工修正/补充（可选）：</div>
                    {(
                      [
                        ['order_id', '订单号'],
                        ['product_name', '产品名称'],
                        ['product_code', '型号/编号'],
                        ['order_qty', '数量'],
                        ['uom', '单位'],
                        ['due_date', '交期'],
                      ] as const
                    ).map(([field, label]) => (
                      <div className={styles.gateRow} key={field} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <span className={styles.gateFieldLabel}>{label}</span>
                        <Input
                          aria-label={`M1 ${label}`}
                          size="small"
                          type={field === 'order_qty' ? 'number' : undefined}
                          min={field === 'order_qty' ? 0.000001 : undefined}
                          disabled={!canOperateBusinessFlow}
                          value={m1Review[field] ?? ''}
                          placeholder={
                            field === 'product_name' && m1OrderLines[0]
                              ? (m1OrderLines[0].name_raw ?? m1OrderLines[0].product_name ?? '')
                              : field === 'order_id' && meta.orderId
                                ? meta.orderId
                                : ''
                          }
                          onChange={(event) => setM1Review((prev) => ({ ...prev, [field]: event.target.value }))}
                        />
                      </div>
                    ))}
                  </div>
                  <FlowActionGate targetId={`${activeRunId ?? 'unknown'}:confirm-m1`}>
                    <GateConfirm
                      confirmLabel="订单无误可继续"
                      confirmDisabled={!m1RequiredFieldsReady}
                      disabled={!canOperateBusinessFlow || !canOperateGate || !activeRunId || Boolean(busy)}
                      supplementReady={
                        m1RequiredFieldsReady
                        && (
                          m1QuantityRequired
                          || m1OrderIdentityRequired
                          || Object.values(m1Review).some((value) => String(value ?? '').trim() !== '')
                        )
                      }
                      supplementContent={
                        <div className={styles.gateRowColumn}>
                          <div className={styles.gateLabel}>人工修正/补充（可选）：</div>
                          {(
                            [
                              ['order_id', '订单号'],
                              ['product_name', '产品名称'],
                              ['product_code', '型号/编号'],
                              ['order_qty', '数量'],
                              ['uom', '单位'],
                              ['due_date', '交期'],
                            ] as const
                          ).map(([field, label]) => (
                            <div className={styles.gateRow} key={field} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              <span className={styles.gateFieldLabel}>{label}</span>
                              <Input
                                aria-label={`M1 ${label}`}
                                size="small"
                                type={field === 'order_qty' ? 'number' : undefined}
                                min={field === 'order_qty' ? 0.000001 : undefined}
                                value={m1Review[field] ?? ''}
                                placeholder={
                                  field === 'product_name' && m1OrderLines[0]
                                    ? (m1OrderLines[0].name_raw ?? m1OrderLines[0].product_name ?? '')
                                    : field === 'order_id' && meta.orderId
                                      ? meta.orderId
                                      : ''
                                }
                                onChange={(event) => setM1Review((prev) => ({ ...prev, [field]: event.target.value }))}
                              />
                            </div>
                          ))}
                        </div>
                      }
                      busy={busy === 'm1' ? 'confirm' : busy === 'm1-supplement' ? 'supplement' : undefined}
                      onConfirm={() => void confirmM1AndContinue()}
                      onSupplement={() => void confirmM1AndContinue()}
                      onExit={exitGate}
                    />
                  </FlowActionGate>
                </div>
              ) : null}
              {canOperateGate && phase === 'human_input_required' && !exceptionGate && isM2Gate ? (
                <div className={styles.gateCard}>
                  <b>M2 需要人工确认以下物料问题</b>
                  {bomApprovalLines.length ? (
                    <div className={styles.gateRowColumn}>
                      <div className={styles.gatePreviewRow}>
                        <div className={styles.gateLabel}>
                          订单涉及物料明细（{bomApprovalLines.length} 行，人工核对用途/用量；库存与缺料在 M3 计算后确认）：
                        </div>
                        <Button
                          size="small"
                          type="link"
                          icon={<EyeOutlined />}
                          onClick={() =>
                            setPreview({
                              title: `M2 订单物料明细（${bomApprovalLines.length} 行）`,
                              columns: [
                                { key: 'code', title: '编码' },
                                { key: 'name', title: '名称' },
                                { key: 'qty', title: '用量' },
                                { key: 'uom', title: '单位' },
                                { key: 'supply', title: '采购/自制' },
                              ],
                              rows: bomApprovalLines.map((line) => ({
                                code: line.component_item ?? 'TBD',
                                name: line.component_name ?? '',
                                qty: line.qty_per != null ? String(line.qty_per) : '',
                                uom: line.uom && line.uom !== 'TBD' ? line.uom : '',
                                supply: line.supply_type === 'BUY' ? '采购件' : line.supply_type === 'MAKE' ? '自制件' : (line.supply_type ?? ''),
                              })),
                            })
                          }
                        >
                          预览物料明细
                        </Button>
                      </div>
                      <div className={styles.gateCandidates}>
                        {bomApprovalLines.slice(0, 8).map((line, index) => {
                          const code = line.component_item ?? 'TBD';
                          const name = line.component_name ?? '';
                          const qty = line.qty_per != null ? ` × ${String(line.qty_per)}` : '';
                          const uom = line.uom && line.uom !== 'TBD' ? ` ${line.uom}` : '';
                          const supply = line.supply_type ? `（${line.supply_type === 'BUY' ? '采购件' : line.supply_type === 'MAKE' ? '自制件' : line.supply_type}）` : '';
                          return (
                            <div className={styles.gateCandidateItem} key={`${code}-${index}`}>
                              {code} {name}{qty}{uom}{supply}
                            </div>
                          );
                        })}
                        {bomApprovalLines.length > 8 ? <div className={styles.gateCandidateItem}>…共 {bomApprovalLines.length} 行，点「预览物料明细」查看</div> : null}
                      </div>
                    </div>
                  ) : null}
                  {m2Questions.length
                    ? m2Questions.map((question) => {
                        const key = question.question_id ?? question.field ?? 'question';
                        const options = Array.isArray(question.options) ? question.options : [];
                        const affected = Array.isArray(question.affected_lines)
                          ? question.affected_lines
                              .map((line) => (typeof line === 'string' ? line : String((line as Record<string, unknown>)?.label ?? (line as Record<string, unknown>)?.name ?? '')))
                              .filter(Boolean)
                          : [];
                        return (
                          <div className={styles.gateRow} key={key}>
                            <div className={styles.gateQuestion}>
                              {question.question ?? key}
                              {question.blocking === false
                                ? <Tag color="green" style={{ marginLeft: 6 }}>已按默认处理</Tag>
                                : <Tag color="orange" style={{ marginLeft: 6 }}>需确认</Tag>}
                            </div>
                            {question.reason
                              ? <div className={styles.gateReasonBlock}>原因：{question.reason}</div>
                              : null}
                            {affected.length
                              ? <div className={styles.gateReasonBlock}>影响：{affected.join('；')}</div>
                              : null}
                            {question.default_policy
                              ? <div className={styles.gateReasonBlock}>默认策略：{question.default_policy}</div>
                              : null}
                            {options.length ? (
                              <Radio.Group
                                size="small"
                                disabled={!canOperateBusinessFlow}
                                value={m2Choices[key]}
                                onChange={(event) => setM2Choices((prev) => ({ ...prev, [key]: String(event.target.value) }))}
                              >
                                {options.map((option) => {
                                  const value = typeof option === 'string' ? option : String(option.value ?? '');
                                  const label = typeof option === 'string' ? option : String(option.label ?? value);
                                  return <Radio.Button key={value} value={value}>{label}</Radio.Button>;
                                })}
                              </Radio.Group>
                            ) : null}
                          </div>
                        );
                      })
                    : (
                        <div className={styles.gateRow}>
                          <div className={styles.gateLabel}>请人工核对订单与 BOM 模板后填写确认说明</div>
                        </div>
                      )}
                  <div className={styles.gateRow}>
                    <Input.TextArea
                      disabled={!canOperateBusinessFlow}
                      value={manualM2Note}
                      placeholder="用一句话说明确认意见，例如：原始证据放备注，旧料号仅作历史别名，工位/设备保持 TBD；留空则全部按默认规则处理"
                      autoSize={{ minRows: 2, maxRows: 4 }}
                      onChange={(event) => setManualM2Note(event.target.value)}
                    />
                  </div>
                  <div className={styles.gateDefaultHint}>未填写将按默认规则处理</div>
                  <FlowActionGate targetId={`${store.runId ?? 'unknown'}:confirm-m2`}>
                    <GateConfirm
                      confirmLabel="Agent 解析确认并继续"
                      supplementReady={manualM2Note.trim().length > 0 || Object.values(m2Choices).some((value) => String(value ?? '').trim() !== '')}
                      supplementContent={
                        <div className={styles.gateRow}>
                          <Input.TextArea
                            value={manualM2Note}
                            placeholder="补充当前 M2 的确认意见，例如：原始证据放备注，旧料号仅作历史别名，工位/设备保持 TBD"
                            autoSize={{ minRows: 2, maxRows: 4 }}
                            onChange={(event) => setManualM2Note(event.target.value)}
                          />
                        </div>
                      }
                      busy={busy === 'm2' ? 'confirm' : busy === 'm2-supplement' ? 'supplement' : undefined}
                      onConfirm={() => void submitAnswers()}
                      onSupplement={() => void submitAnswers()}
                      onExit={exitGate}
                    />
                  </FlowActionGate>
                </div>
              ) : null}
              {canOperateGate && !exceptionGate && isBomApprovalGate ? (
                <div className={styles.gateCard}>
                  <b>M3 上游 BOM 未批准，需人工审核</b>
                  <div className={styles.gateLabel}>
                    M2 已生成草稿 BOM（状态 draft_pending_engineering_review），M3 治理门要求人工审核批准后才能正式释放采购与排程。请核对下方 BOM 明细，确认无误后批准继续。
                  </div>
                  {bomApprovalLines.length ? (
                    <div className={styles.gateRowColumn}>
                      <div className={styles.gatePreviewRow}>
                        <div className={styles.gateLabel}>待批准 BOM 明细（{bomApprovalLines.length} 行）：</div>
                        <Button
                          size="small"
                          type="link"
                          icon={<EyeOutlined />}
                          onClick={() =>
                            setPreview({
                              title: `待批准 BOM 明细（${bomApprovalLines.length} 行）`,
                              columns: [
                                { key: 'code', title: '编码' },
                                { key: 'name', title: '名称' },
                                { key: 'qty', title: '用量' },
                                { key: 'uom', title: '单位' },
                                { key: 'scrap', title: '损耗%' },
                                { key: 'supply', title: '类型' },
                              ],
                              rows: bomApprovalLines.map((line) => ({
                                code: line.component_item ?? 'TBD',
                                name: line.component_name ?? '',
                                qty: line.qty_per != null ? String(line.qty_per) : '',
                                uom: line.uom ?? '',
                                scrap: line.scrap_pct != null ? String(line.scrap_pct) : '',
                                supply: line.supply_type ?? '',
                              })),
                            })
                          }
                        >
                          预览全部 BOM 明细
                        </Button>
                      </div>
                      <div className={styles.gateCandidates}>
                        {bomApprovalLines.slice(0, 10).map((line, index) => (
                          <div className={styles.gateCandidateItem} key={`${line.component_item ?? 'line'}-${index}`}>
                            {line.component_item ?? 'TBD'} {line.component_name ?? ''}
                            {line.qty_per != null ? ` · 用量 ${String(line.qty_per)}` : ''}
                            {line.uom ? ` ${line.uom}` : ''}
                            {line.scrap_pct != null ? ` · 损耗 ${String(line.scrap_pct)}` : ''}
                            {line.supply_type ? ` · ${line.supply_type}` : ''}
                          </div>
                        ))}
                        {bomApprovalLines.length > 10 ? <div className={styles.gateCandidateItem}>…共 {bomApprovalLines.length} 行，点「预览全部 BOM 明细」查看</div> : null}
                      </div>
                    </div>
                  ) : (
                    <div className={styles.gateHint}>BOM 明细数据未完善，当前不能批准或跳过；请补齐权威数据后继续。</div>
                  )}
                  <Alert
                    type="warning"
                    showIcon
                    message="BOM 未批准将无法进入采购与排程，请逐行核对用量与损耗后批准"
                    style={{ marginBottom: 8 }}
                  />
                  <FlowActionGate
                    targetId={`${store.runId ?? 'unknown'}:approve-bom`}
                    permission="m0:bom:approve"
                  >
                    <GateConfirm
                      confirmLabel="审核通过，批准 BOM 并继续"
                      confirmDisabled={!bomApprovalLines.length}
                      supplementReady={supplementBomNote.trim().length > 0}
                      supplementContent={
                        <Input.TextArea
                          value={supplementBomNote}
                          placeholder="补充当前 BOM 审核意见、数据来源或逐行核对说明"
                          autoSize={{ minRows: 2, maxRows: 4 }}
                          onChange={(event) => setSupplementBomNote(event.target.value)}
                        />
                      }
                      busy={busy === 'bom-approve' ? 'confirm' : busy === 'bom-approve-supplement' ? 'supplement' : undefined}
                      onConfirm={() => void approveBomAndContinue()}
                      onSupplement={() => void approveBomAndContinue()}
                      onExit={exitGate}
                    />
                  </FlowActionGate>
                </div>
              ) : null}
              {canOperateGate && isLegacyM3GateContext && !exceptionGate && m3Matching.length ? (
                <div className={styles.gateCard}>
                  <b>M3 物料匹配需人工核验</b>
                  {m3Matching.map((item) => {
                    const score = (item.candidateScore ?? 0) >= 0 ? Math.round((item.candidateScore ?? 0) * 100) : null;
                    const low = score !== null && score < 60;
                    return (
                      <div className={styles.gateMatchingRow} key={item.material_code}>
                        <div className={styles.gateLabel}>
                          <b>{item.material_code}</b> {item.material_name ?? ''}
                          {' · 最高匹配候选：'}
                          {item.candidateCode ?? '无'}
                          {score !== null ? `（${score}%${low ? '，低置信度' : ''}）` : '（—）'}
                          {low ? <Tag color="orange" className={styles.gateLowConfidence}>低置信度，请人工核对</Tag> : null}
                        </div>
                      </div>
                    );
                  })}
                  <Space className={styles.gateSubmit} wrap>
                    <FlowActionGate targetId={`${store.runId ?? 'unknown'}:accept-best-match`}>
                      <GateConfirm
                        confirmLabel="采用最高匹配候选并继续"
                        supplementReady={m3Matching.some(
                          (item) => Boolean((manualChoices[item.material_code] ?? '').trim() || manualCustom[item.material_code] || item.candidateCode),
                        )}
                        supplementContent={
                          <div className={styles.gateRowColumn}>
                            {m3Matching.map((item) => (
                              <div className={styles.gateRow} key={item.material_code} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <span className={styles.gateFieldLabel}>
                                  {item.material_code} {item.material_name ?? ''}
                                </span>
                                <Select
                                  style={{ width: '100%', minWidth: 160 }}
                                  showSearch
                                  allowClear
                                  placeholder="选择候选 ERP 物料"
                                  value={manualChoices[item.material_code] ?? item.candidateCode}
                                  onChange={(value) =>
                                    setManualChoices((prev) => ({ ...prev, [item.material_code]: value ?? '' }))
                                  }
                                  options={item.candidates.map((candidate) => ({
                                    value: candidate.material_code,
                                    label: `${candidate.material_code} ${candidate.material_name ?? ''}${
                                      candidate.score !== undefined ? `（${Math.round(candidate.score * 100)}%）` : ''
                                    }${candidate.conflicts ? ` [${candidate.conflicts}]` : ''}`,
                                  }))}
                                />
                              </div>
                            ))}
                          </div>
                        }
                        busy={busy === 'm3-review' ? 'confirm' : undefined}
                        onConfirm={() => void submitMatchingReview()}
                        onSupplement={() => setManualMatchingOpen(true)}
                        onExit={exitGate}
                      />
                    </FlowActionGate>
                    <FlowActionGate targetId={`${store.runId ?? 'unknown'}:open-manual-match`}>
                      <Button onClick={() => setManualMatchingOpen(true)}>
                        人工匹配
                      </Button>
                    </FlowActionGate>
                  </Space>
                </div>
              ) : null}
              {canOperateGate && isLegacyM3GateContext && !exceptionGate && m3Matching.length === 0 && shortages.length ? (
                <div className={styles.gateCard}>
                  <b>物料缺料</b>
                  <Tag color="error" className={styles.gateCriticalTag}>缺料 {shortages.length} 项</Tag>
                  <div className={styles.gateLabel}>请按建议采购量补货入账后继续：</div>
                  {shortages.map((item) => (
                    <div className={styles.gateShortageRow} key={item.material_code}>
                      <div className={styles.gateLabel}>
                        <b>{item.material_code}</b> {item.material_name ?? ''}
                        {' · 缺 '}<span className={styles.gateCritical}>{item.shortage_qty ?? 0}</span>
                        {' · 建议采购 '}<span className={styles.gateCritical}>{item.suggest_purchase_qty ?? 0}</span>
                      </div>
                      <InputNumber
                        min={0}
                        precision={2}
                        disabled={!canOperateBusinessFlow}
                        value={restock[item.material_code] ?? item.suggest_purchase_qty ?? item.shortage_qty ?? 0}
                        onChange={(value) => setRestock((prev) => ({ ...prev, [item.material_code]: Number(value ?? 0) }))}
                      />
                    </div>
                  ))}
                  <FlowActionGate targetId={`${store.runId ?? 'unknown'}:restock`}>
                    <Tooltip title={m3Matching.length ? '存在待人工核验的物料匹配，请先完成“人工匹配”' : undefined}>
                      <GateConfirm
                        confirmLabel="补货入账并继续"
                        confirmDisabled={m3Matching.length > 0}
                        supplementReady={Object.values(restock).some((value) => Number(value ?? 0) > 0)}
                        supplementContent={
                          <div className={styles.gateRowColumn}>
                            {shortages.map((item) => (
                              <div className={styles.gateShortageRow} key={item.material_code}>
                                <div className={styles.gateLabel}>
                                  <b>{item.material_code}</b> {item.material_name ?? ''}
                                  {' · 缺 '}<span className={styles.gateCritical}>{item.shortage_qty ?? 0}</span>
                                  {' · 建议采购 '}<span className={styles.gateCritical}>{item.suggest_purchase_qty ?? 0}</span>
                                </div>
                                <InputNumber
                                  min={0}
                                  precision={2}
                                  value={restock[item.material_code] ?? item.suggest_purchase_qty ?? item.shortage_qty ?? 0}
                                  onChange={(value) => setRestock((prev) => ({ ...prev, [item.material_code]: Number(value ?? 0) }))}
                                />
                              </div>
                            ))}
                          </div>
                        }
                        busy={busy === 'm3' ? 'confirm' : busy === 'm3-supplement' ? 'supplement' : undefined}
                        onConfirm={() => void submitRestock()}
                        onSupplement={() => void submitRestock()}
                        onExit={exitGate}
                      />
                    </Tooltip>
                  </FlowActionGate>
                </div>
              ) : null}
              {!exceptionGate && isM3PlanGate ? (
                <div className={styles.gateCard}>
                  <b>M3 物料计划需人工确认</b>
                  <div className={styles.gateLabel}>请核对当前物料计划与权威数据；确认无误或填写本节点补充说明后恢复同一受治理流程。</div>
                  <FlowActionGate targetId={`${store.runId ?? 'unknown'}:confirm-m3-plan`}>
                    <GateConfirm
                      confirmLabel="确认 M3 物料计划并继续"
                      supplementReady={supplementGateNote.trim().length > 0}
                      supplementContent={
                        <Input.TextArea
                          value={supplementGateNote}
                          placeholder="补充当前 M3 的物料、库存或计划信息"
                          autoSize={{ minRows: 2, maxRows: 4 }}
                          onChange={(event) => setSupplementGateNote(event.target.value)}
                        />
                      }
                      busy={busy === 'gate-confirm' ? 'confirm' : busy === 'gate-supplement' ? 'supplement' : undefined}
                      onConfirm={() => void resumeGateWithComment()}
                      onSupplement={() => void resumeGateWithComment()}
                      onExit={exitGate}
                    />
                  </FlowActionGate>
                </div>
              ) : null}
              {isM4Gate ? (
                <div className={styles.gateCard}>
                  <b>M4 采购信息需人工确认</b>
                  <div className={styles.gateLabel}>请核对当前采购信息；确认无误或填写本节点补充说明后恢复同一受治理流程。</div>
                  <FlowActionGate targetId={`${store.runId ?? 'unknown'}:confirm-m4`}>
                    <GateConfirm
                      confirmLabel="确认 M4 采购信息并继续"
                      supplementReady={supplementGateNote.trim().length > 0}
                      supplementContent={
                        <Input.TextArea
                          value={supplementGateNote}
                          placeholder="补充当前 M4 的采购审核信息"
                          autoSize={{ minRows: 2, maxRows: 4 }}
                          onChange={(event) => setSupplementGateNote(event.target.value)}
                        />
                      }
                      busy={busy === 'gate-confirm' ? 'confirm' : busy === 'gate-supplement' ? 'supplement' : undefined}
                      onConfirm={() => void resumeGateWithComment()}
                      onSupplement={() => void resumeGateWithComment()}
                      onExit={exitGate}
                    />
                  </FlowActionGate>
                </div>
              ) : null}
              {canOperateGate && isM5Gate ? (
                <div className={styles.gateCard}>
                  <b>M5 缺少权威产能事实（受控演示）</b>
                  <div className={styles.gateLabel}>可载入受控排程 fixture（4 道标准工序、4 个独立工位、7 天班次窗口）继续演示排程。正式发布仍需真实工艺/资源/班次。</div>
                  <FlowActionGate
                    targetId={`${store.runId ?? 'unknown'}:load-m5-fixture`}
                    permission="schedule:write"
                  >
                    <GateConfirm
                      confirmLabel="载入受控排程 fixture 并继续"
                      supplementReady={supplementGateNote.trim().length > 0}
                      supplementContent={
                        <Input.TextArea
                          value={supplementGateNote}
                          placeholder="补充当前 M5 的产能事实说明；受控 fixture 仍只用于 pressure_only 演示"
                          autoSize={{ minRows: 2, maxRows: 4 }}
                          onChange={(event) => setSupplementGateNote(event.target.value)}
                        />
                      }
                      busy={busy === 'm5' ? 'confirm' : busy === 'm5-supplement' ? 'supplement' : undefined}
                      onConfirm={() => void loadM5Fixture()}
                      onSupplement={() => void loadM5Fixture()}
                      onExit={exitGate}
                    />
                  </FlowActionGate>
                </div>
              ) : null}
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      <Modal
        title="M3 物料人工匹配"
        open={manualMatchingOpen && canOperateGate && canOperateBusinessFlow}
        width={760}
        okText="采用所选匹配并继续"
        confirmLoading={busy === 'm3-review'}
        okButtonProps={{ disabled: !canOperateBusinessFlow }}
        onOk={() => void submitManualMatching()}
        onCancel={() => setManualMatchingOpen(false)}
        destroyOnHidden
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {m3Matching.map((item) => (
            <div className={styles.gateCard} key={item.material_code} style={{ marginBottom: 0 }}>
              <div className={styles.gateLabel}>
                {item.material_code} {item.material_name} · 当前最高候选：
                {item.candidateCode ?? '无'}（{(item.candidateScore ?? 0) >= 0 ? `${Math.round((item.candidateScore ?? 0) * 100)}%` : '—'}）
              </div>
              <Space direction="vertical" size={6} style={{ width: '100%', marginTop: 8 }}>
                <Select
                  style={{ width: '100%' }}
                  showSearch
                  allowClear
                  disabled={!canOperateBusinessFlow}
                  placeholder="选择候选 ERP 物料"
                  value={manualChoices[item.material_code] ?? item.candidateCode}
                  onChange={(value) =>
                    setManualChoices((prev) => ({ ...prev, [item.material_code]: value ?? '' }))
                  }
                  options={item.candidates.map((candidate) => ({
                    value: candidate.material_code,
                    label: `${candidate.material_code} ${candidate.material_name ?? ''}${
                      candidate.score !== undefined ? `（${Math.round(candidate.score * 100)}%）` : ''
                    }${candidate.conflicts ? ` [${candidate.conflicts}]` : ''}`,
                  }))}
                />
                <Input
                  placeholder="或手动输入 ERP 编码（不在候选列表中时）"
                  disabled={!canOperateBusinessFlow}
                  value={manualCustom[item.material_code] ?? ''}
                  onChange={(event) =>
                    setManualCustom((prev) => ({ ...prev, [item.material_code]: event.target.value }))
                  }
                />
              </Space>
            </div>
          ))}
        </Space>
      </Modal>
      <DataPreviewModal
        open={preview !== null}
        title={preview?.title ?? ''}
        columns={preview?.columns ?? []}
        rows={preview?.rows ?? []}
        onClose={() => setPreview(null)}
      />
    </section>
  );
}
