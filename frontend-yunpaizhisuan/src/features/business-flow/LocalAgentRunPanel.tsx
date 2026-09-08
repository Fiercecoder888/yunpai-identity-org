import {
  ApartmentOutlined,
  CalendarOutlined,
  CalculatorOutlined,
  CloseOutlined,
  EyeOutlined,
  FileSearchOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  ShoppingCartOutlined,
  DeleteOutlined,
  DownOutlined,
  UpOutlined,
} from '@ant-design/icons';
import { Alert, Button, Empty, Popconfirm, Select, Space, Tag, Tooltip, message } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { deleteLocalRuns, listLocalRuns, getLocalRun, type LocalRun, type LocalRunStep } from '../../services/localRunApi';
import type { ChatStreamRequest } from '../../services/chatApi';
import { useChatStore } from '../../store/useChatStore';
import { readLocalOrders, removeLocalOrder, type LocalOrderRecord } from './localOrderRegistry';
import styles from './LocalAgentRunPanel.module.css';

type StageId = 'm1' | 'm2' | 'm3' | 'm4' | 'm5';
type StageStatus = 'idle' | 'running' | 'ok' | 'attention' | 'failed';
type LocalOrderSummary = LocalOrderRecord & { runs: LocalRun[] };

const STAGES: Array<{ id: StageId; name: string; icon: ReactNode }> = [
  { id: 'm1', name: '订单解析', icon: <FileSearchOutlined /> },
  { id: 'm2', name: 'BOM/SOP', icon: <ApartmentOutlined /> },
  { id: 'm3', name: '物料计算', icon: <CalculatorOutlined /> },
  { id: 'm4', name: '采购建议', icon: <ShoppingCartOutlined /> },
  { id: 'm5', name: '排程输出', icon: <CalendarOutlined /> },
];

const statusLabel: Record<string, string> = {
  queued: '排队中', running: '运行中', waiting_human: '等待人工', completed: '已完成',
  failed: '失败', cancelled: '已取消', blocked: '已阻断', data_incomplete: '资料不足',
};

const asText = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try { return JSON.stringify(value); } catch { return String(value); }
};

const moduleForStep = (step: LocalRunStep) => String(step.module ?? '').toLowerCase();
const statusForStep = (step: LocalRunStep): StageStatus => {
  const status = String(step.status ?? '').toLowerCase();
  if (status === 'failed' || status === 'error') return 'failed';
  if (status === 'running' || status === 'started') return 'running';
  if (status === 'blocked' || status === 'waiting_human') return 'attention';
  if (status === 'completed' || status === 'ok' || status === 'done') return 'ok';
  return 'idle';
};

const stageStep = (run: LocalRun | undefined, stage: StageId) =>
  [...(run?.steps ?? [])].reverse().find((item) => moduleForStep(item) === stage);

const stageState = (run: LocalRun | undefined, stage: StageId): StageStatus => {
  if (!run) return 'idle';
  const gateModule = String(run.pending_gate?.module ?? '').toLowerCase();
  if (gateModule === stage) return 'attention';
  const step = stageStep(run, stage);
  if (step) return statusForStep(step);
  const current = String(run.current_step ?? '').toLowerCase();
  if (current.includes(stage) && ['running', 'queued'].includes(run.status)) return 'running';
  return 'idle';
};

const stageSummary = (run: LocalRun | undefined, stage: StageId) => {
  const gateModule = String(run?.pending_gate?.module ?? '').toLowerCase();
  if (gateModule === stage) return '等待人工确认';
  const step = stageStep(run, stage);
  if (!step) return '未执行';
  if (step.status === 'completed' && step.output_summary) return asText(step.output_summary).slice(0, 80);
  if (step.status === 'failed') return '执行失败';
  if (step.status === 'blocked' || step.status === 'waiting_human') return '等待人工确认';
  return step.tool || '处理中';
};

const runLabel = (run: LocalRun) => {
  const request = run.request ?? {};
  const message = typeof request.message === 'string' ? request.message : '未提供运行消息';
  return `${message.slice(0, 70)} · ${statusLabel[run.status] ?? run.status}`;
};

const objectValues = (value: unknown): Record<string, unknown>[] => {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(objectValues);
  const object = value as Record<string, unknown>;
  return [object, ...Object.values(object).flatMap(objectValues)];
};

const orderRefsFromRun = (run: LocalRun) => {
  const request = run.request ?? {};
  const candidates = [request.document, request.order, request.orders, request.documents];
  const refs: Array<{ orderId: string; productName?: string; filename?: string }> = [];
  for (const candidate of candidates) {
    for (const item of objectValues(candidate)) {
      const orderId = String(item.order_id ?? item.order_number ?? item.customer_order_number ?? '').trim();
      const filename = String(item.filename ?? item.name ?? '').trim() || undefined;
      const productName = String(item.product_name ?? item.productName ?? '').trim() || undefined;
      if (orderId) refs.push({ orderId, productName, filename });
      else if (filename) refs.push({ orderId: filename, filename, productName });
    }
  }
  // 请求体里只有文件名（中文/乱码）没有订单号时，M1 解析后才有真实 order_id
  // （outputs.ingest_document.document.header.order_id）。用真实订单号覆盖文件名
  // 兜底条目，否则面板会显示「桐曦PO...xlsx」这种乱码名，找不到真实单号。
  const hasRealOrderId = refs.some((ref) =>
    !(/\.(xlsx|xls|csv|pdf|zip|rar|txt)$/i.test(ref.orderId)) && !ref.orderId.includes('订单'),
  );
  const ingested = run.outputs?.ingest_document as Record<string, unknown> | undefined;
  const document = ingested && typeof ingested.document === 'object' ? ingested.document as Record<string, unknown> : {};
  const header = document.header && typeof document.header === 'object' ? document.header as Record<string, unknown> : {};
  const outputOrderId = String(header.order_id ?? header.order_number ?? '').trim();
  if (!hasRealOrderId && outputOrderId) {
    const filename = (refs[0]?.filename
      ?? String(document.source && typeof document.source === 'object' ? (document.source as Record<string, unknown>).original_filename ?? '' : '').trim())
      || undefined;
    const productName = String(header.product_code ?? header.product_name ?? '').trim() || undefined;
    return [{ orderId: outputOrderId, productName: productName || undefined, filename: filename || undefined }];
  }
  return refs.filter((item, index) => refs.findIndex((candidate) => candidate.orderId === item.orderId) === index);
};

const orderStatus = (order: LocalOrderSummary): { label: string; color: string } => {
  const latest = order.runs[0];
  if (!latest) return { label: '未运行', color: 'default' };
  if (latest.pending_gate) return { label: '等待人工', color: 'warning' };
  if (latest.status === 'completed') return { label: '已完成', color: 'success' };
  if (latest.status === 'failed') return { label: '失败', color: 'error' };
  if (latest.status === 'running' || latest.status === 'queued') return { label: '运行中', color: 'processing' };
  return { label: statusLabel[latest.status] ?? latest.status, color: 'default' };
};

const stageRecords = (order: LocalOrderSummary, stage: StageId) =>
  order.runs.filter((run) => stageStep(run, stage) || String(run.pending_gate?.module ?? '').toLowerCase() === stage);

const stageStatusColor = (status: StageStatus) =>
  status === 'ok' ? 'success' : status === 'failed' ? 'error' : status === 'attention' ? 'warning' : status === 'running' ? 'processing' : 'default';

export function LocalAgentRunPanel({ pmcProgressRequest = 0 }: { pmcProgressRequest?: number }) {
  const sendMessage = useChatStore((state) => state.sendMessage);
  const sending = useChatStore((state) => state.sending);
  const activeLocalRunId = useChatStore((state) => state.activeLocalRunId);
  const resolveStaleGate = useChatStore((state) => state.resolveStaleGate);
  const [focusedOrderId, setFocusedOrderId] = useState<string>();
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [expanded, setExpanded] = useState(true);
  const [detailStage, setDetailStage] = useState<StageId>();
  const [localOrders, setLocalOrders] = useState<LocalOrderRecord[]>(() => readLocalOrders());
  const runsQuery = useQuery({ queryKey: ['local-agent-runs'], queryFn: () => listLocalRuns(), refetchInterval: 4_000 });
  const selectedFromList = runsQuery.data?.find((run) => run.run_id === selectedRunId);
  const detailQuery = useQuery({
    queryKey: ['local-agent-run', selectedRunId],
    queryFn: () => getLocalRun(selectedRunId as string),
    enabled: Boolean(selectedRunId),
    refetchInterval: selectedFromList && ['running', 'queued', 'waiting_human'].includes(selectedFromList.status) ? 2_000 : false,
  });
  const selectedRun = detailQuery.data ?? selectedFromList;

  // run 已结束（completed/failed）但会话消息里的 Gate 仍标记 pending/error 时，
  // 视为已解决（例如「计划不存在」回读失败已由后端修复并重试完成），
  // 避免右下角通知和会话卡片一直报旧错误。只在确认存在滞留 Gate 时才更新。
  useEffect(() => {
    if (!runsQuery.data) return;
    const staleRunIds = runsQuery.data
      .filter((run) => !['running', 'queued', 'waiting_human'].includes(String(run.status)))
      .map((run) => run.run_id);
    if (!staleRunIds.length) return;
    const hasStale = [...Object.values(useChatStore.getState().messageSets), useChatStore.getState().messages]
      .some((messages) => messages.some((item) =>
        item.gate && staleRunIds.includes(item.gate.runId) && (!item.gate.status || item.gate.status === 'pending' || item.gate.status === 'error')));
    if (!hasStale) return;
    for (const runId of staleRunIds) resolveStaleGate(runId);
  }, [runsQuery.data, resolveStaleGate]);

  const orderSummaries = useMemo<LocalOrderSummary[]>(() => {
    const map = new Map<string, LocalOrderSummary>();
    for (const item of localOrders) map.set(item.orderId, { ...item, runs: [] });
    for (const run of runsQuery.data ?? []) {
      for (const ref of orderRefsFromRun(run)) {
        const current = map.get(ref.orderId) ?? { orderId: ref.orderId, updatedAt: new Date().toISOString(), runs: [] };
        map.set(ref.orderId, {
          ...current,
          filename: current.filename ?? ref.filename,
          productName: current.productName ?? ref.productName,
          runs: current.runs.some((item) => item.run_id === run.run_id) ? current.runs : [...current.runs, run],
        });
      }
    }
    return [...map.values()];
  }, [localOrders, runsQuery.data]);

  const focusedOrder = orderSummaries.find((item) => item.orderId === focusedOrderId);
  const orderOptions = orderSummaries.map((order) => {
    const summary = orderStatus(order);
    const latest = order.runs[0];
    const progress = STAGES.map((stage) => stageState(latest, stage.id) === 'ok' ? `${stage.id.toUpperCase()}✓` : stage.id.toUpperCase()).join(' ');
    return { value: order.orderId, label: `${order.orderId} · ${summary.label} · ${progress}` };
  });

  useEffect(() => {
    setLocalOrders(readLocalOrders());
  }, [runsQuery.data]);

  useEffect(() => {
    if (activeLocalRunId) {
      const match = orderSummaries.find((order) => order.runs.some((run) => run.run_id === activeLocalRunId));
      if (match) setFocusedOrderId(match.orderId);
    }
    if (!focusedOrderId && orderSummaries[0]) setFocusedOrderId(orderSummaries[0].orderId);
  }, [activeLocalRunId, focusedOrderId, orderSummaries]);

  useEffect(() => {
    if (!focusedOrder) {
      setSelectedRunId(undefined);
      setDetailStage(undefined);
      return;
    }
    const latestRun = focusedOrder.runs[0];
    if (latestRun && !focusedOrder.runs.some((run) => run.run_id === selectedRunId)) setSelectedRunId(latestRun.run_id);
    setDetailStage(undefined);
  }, [focusedOrder, selectedRunId]);

  useEffect(() => {
    if (pmcProgressRequest > 0) setExpanded(true);
  }, [pmcProgressRequest]);

  const hasSchedule = Boolean(selectedRun?.outputs?.solve_scheduling);
  const selectedRequest = selectedRun?.request as ChatStreamRequest | undefined;
  const runAgain = () => {
    if (!selectedRequest?.message) return;
    void sendMessage(selectedRequest.message, undefined, undefined, {
      document: selectedRequest.document,
      documents: selectedRequest.documents,
      attachments: selectedRequest.attachments,
      options: selectedRequest.options,
      tools: selectedRequest.tools,
      use_memory: selectedRequest.use_memory,
    });
  };

  const [deletingOrder, setDeletingOrder] = useState<string>();
  const deleteOrder = async (order: LocalOrderSummary) => {
    setDeletingOrder(order.orderId);
    try {
      // 删除该订单关联的所有 run（历史运行/进行中），再清本地订单注册表。
      const runIds = [...new Set(order.runs.map((run) => run.run_id).filter(Boolean))];
      if (runIds.length) await deleteLocalRuns(runIds);
      removeLocalOrder(order.orderId);
      setLocalOrders(readLocalOrders());
      if (focusedOrderId === order.orderId) {
        setFocusedOrderId(undefined);
        setSelectedRunId(undefined);
        setDetailStage(undefined);
      }
      void runsQuery.refetch();
      message.success(`订单 ${order.orderId} 已删除${runIds.length ? `（含 ${runIds.length} 条运行记录）` : ''}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '订单删除失败');
    } finally {
      setDeletingOrder(undefined);
    }
  };

  return (
    <section className={styles.panel} aria-label="订单管理与 M1-M5 流程">
      <div className={styles.context}>
        <div className={styles.contextMain}>
          <div className={styles.title}>订单管理</div>
          <span className={styles.orderCount}>已上传 {orderSummaries.length} 个订单</span>
          <Select
            aria-label="选择订单"
            className={styles.orderSelect}
            showSearch
            optionFilterProp="label"
            value={focusedOrderId}
            loading={runsQuery.isLoading && !orderSummaries.length}
            placeholder="选择订单查看 M1-M5"
            options={orderOptions}
            onChange={(value) => { setFocusedOrderId(value); const order = orderSummaries.find((item) => item.orderId === value); if (order?.runs[0]) setSelectedRunId(order.runs[0].run_id); }}
          />
          {focusedOrder ? <Tag color={orderStatus(focusedOrder).color}>当前：{orderStatus(focusedOrder).label}</Tag> : null}
        </div>
        <Space size={6} className={styles.actions}>
          <Tooltip title="重新读取订单和运行状态">
            <Button size="small" icon={<ReloadOutlined />} onClick={() => { setLocalOrders(readLocalOrders()); void runsQuery.refetch(); }} aria-label="刷新订单状态" />
          </Tooltip>
          <Tooltip title="使用当前订单最近一次请求重新运行">
            <Button size="small" icon={<PlayCircleOutlined />} disabled={!selectedRequest?.message || sending} onClick={runAgain}>重新运行</Button>
          </Tooltip>
          <Button size="small" type="text" icon={expanded ? <UpOutlined /> : <DownOutlined />} aria-label={expanded ? '收起订单管理' : '展开订单管理'} onClick={() => setExpanded((value) => !value)} />
        </Space>
      </div>

      {runsQuery.isError ? <Alert type="warning" showIcon message="本地运行记录读取失败" description="请确认本机 LangGraph 服务正在 9000 端口运行。" /> : null}
      {expanded ? (
        <div className={styles.body}>
          <div className={styles.orderHint}>订单列表已收起；通过上方“选择订单”查看指定订单的 M1-M5 流程。切换订单不会切换会话或重新执行。</div>
          {runsQuery.isLoading && !orderSummaries.length ? <div className={styles.historyLoading}>正在加载订单状态...</div> : null}
          {!runsQuery.isLoading && !orderSummaries.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已上传订单" /> : null}

          {focusedOrder ? (
            <>
              <div className={styles.focusedOrderHeading}>
                <div><b>当前查看订单：{focusedOrder.orderId}</b><span>{focusedOrder.productName ?? focusedOrder.filename ?? '未提供产品信息'}</span></div>
                <span>
                  {focusedOrder.runs.length ? `关联运行 ${focusedOrder.runs.length} 次` : '尚未运行'}
                  <Popconfirm
                    title={`删除订单 ${focusedOrder.orderId}？`}
                    description="将删除该订单的本地运行记录（M1-M5 历史），对话消息不受影响。"
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true, loading: deletingOrder === focusedOrder.orderId }}
                    onConfirm={() => void deleteOrder(focusedOrder)}
                  >
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      loading={deletingOrder === focusedOrder.orderId}
                      aria-label={`删除订单 ${focusedOrder.orderId}`}
                      style={{ marginLeft: 6 }}
                    />
                  </Popconfirm>
                </span>
              </div>
              <div className={styles.badge}>ORDER FLOW · M1-M5</div>
              <div className={styles.flowTrack}>
                {STAGES.map((stage, index) => {
                  const status = stageState(selectedRun, stage.id);
                  const records = stageRecords(focusedOrder, stage.id);
                  return (
                    <div className={styles.stageWrap} key={stage.id}>
                      <div className={`${styles.stage} ${styles[`is-${status}`]}`}>
                        <div className={styles.stageIcon}>{stage.icon}</div>
                        <div className={styles.stageHead}><b>{stage.id.toUpperCase()}</b><small>{stage.name}</small></div>
                        <Tag color={stageStatusColor(status)}>{status === 'ok' ? '已完成' : status === 'failed' ? '失败' : status === 'attention' ? '等待人工' : status === 'running' ? '运行中' : '未执行'}</Tag>
                        <div className={styles.summary}>{stageSummary(selectedRun, stage.id)}</div>
                        {records.length ? <button type="button" className={styles.stageHistoryButton} onClick={() => setDetailStage(stage.id)}><EyeOutlined /> 查看记录 ({records.length})</button> : null}
                      </div>
                      {index < STAGES.length - 1 ? <div className={styles.connector} aria-hidden="true" /> : null}
                    </div>
                  );
                })}
              </div>
              {detailStage ? (
                <div className={styles.stageRecords} aria-label={`${detailStage.toUpperCase()} 运行记录`}>
                  <div className={styles.stageRecordsHeader}><b>{detailStage.toUpperCase()} 运行记录</b><button type="button" onClick={() => setDetailStage(undefined)} aria-label="关闭阶段运行记录"><CloseOutlined /></button></div>
                  {stageRecords(focusedOrder, detailStage).map((run) => {
                    const step = stageStep(run, detailStage);
                    const gate = String(run.pending_gate?.module ?? '').toLowerCase() === detailStage;
                    return <article className={styles.stageRecord} key={run.run_id}>
                      <div><Tag color={gate ? 'warning' : run.status === 'completed' ? 'success' : run.status === 'failed' ? 'error' : 'processing'}>{gate ? '等待人工' : statusLabel[run.status] ?? run.status}</Tag><span>run {run.run_id.slice(0, 18)}</span></div>
                      <b>{step?.tool ?? (gate ? String(run.pending_gate?.message ?? '等待人工确认') : runLabel(run))}</b>
                      <p>{step?.output_summary ? asText(step.output_summary) : run.response || '暂无输出摘要'}</p>
                    </article>;
                  })}
                </div>
              ) : null}
              {selectedRun?.pending_gate ? <Alert type="warning" showIcon message="该订单当前运行等待人工确认" description={String(selectedRun.pending_gate.message ?? selectedRun.pending_gate.type ?? '请在对话区处理人工 Gate。')} /> : null}
              {selectedRun && hasSchedule ? <div className={styles.scheduleNote}>该订单已产生 M5 排程输出</div> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
