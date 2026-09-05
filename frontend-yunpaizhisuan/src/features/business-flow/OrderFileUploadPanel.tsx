import { CloudUploadOutlined, LoadingOutlined, PlayCircleOutlined, UploadOutlined } from '@ant-design/icons';
import { Alert, AutoComplete, Button, Input, Segmented, Space, Upload, message, type UploadFile } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getCatalogRunConfigs,
  resumeBusinessFlow,
  runBusinessFlow,
  type BusinessFlowRunProgress,
} from '../../services/businessFlowRunApi';
import { uploadOrderFile, waitForM1Task, type M1IngestDetail } from '../../services/m1IngestApi';
import { useChatStore } from '../../store/useChatStore';
import { HttpClientError } from '../../services/httpClient';
import { useBusinessRunStore } from './useBusinessRunStore';
import { rememberLocalOrder } from './localOrderRegistry';
import { TaskId } from '../../components/TaskId';
import { buildOrderNameHint } from '../upload/orderNameHint';
import { validateFile } from '../upload/validateFile';
import { MAX_ORDER_FILE_MB, ORDER_EXTENSIONS } from '../upload/uploadConstants';
import styles from './OrderFileUploadPanel.module.css';

const CANDIDATE_RUNS_KEY = 'yunpai-candidate-runs';
const NO_CONVERSATION = '__no-conversation__';

const currentConversationId = () => useChatStore.getState().selectedConversationId ?? NO_CONVERSATION;
const isCurrentConversation = (conversationId: string) => currentConversationId() === conversationId;
const positiveQuantity = (value: unknown): number | undefined => {
  const quantity = Number(String(value ?? '').trim());
  return Number.isFinite(quantity) && quantity > 0 ? quantity : undefined;
};

const fileToBase64 = async (file: File) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

/** 把运行失败原因翻译成用户可理解的提示；409 幂等冲突重点解释“同一文件重复提交”。 */
function describeRunFailure(
  cause: unknown,
  fallbackTitle: string,
): { title: string; message: string } {
  if (cause instanceof HttpClientError) {
    const detail = (cause.error.detail ?? {}) as { code?: string; message?: string };
    if (cause.error.status === 409 && detail.code === 'business_flow_idempotency_conflict') {
      return {
        title: '该文件已提交过业务流程',
        message:
          '此文件此前已提交过且本次参数（如订单类型/产品名/数量）与已提交内容不同，' +
          '服务端按幂等规则拒绝了重复提交。若要以「预订单/样品单」重新处理，请更换文件名后重新上传。',
      };
    }
    return { title: fallbackTitle, message: cause.message };
  }
  const messageText = cause instanceof Error ? cause.message : String(cause);
  return { title: fallbackTitle, message: messageText };
}

function registerFlowRun(catalogId: string, taskId: string, runId?: string) {
  try {
    const existing = JSON.parse(localStorage.getItem(CANDIDATE_RUNS_KEY) || '{}') as Record<
      string,
      { task_id?: string; run_id?: string }
    >;
    existing[catalogId] = { task_id: taskId, run_id: runId };
    localStorage.setItem(CANDIDATE_RUNS_KEY, JSON.stringify(existing));
  } catch {
    // A browser storage failure must not cancel the server-owned flow.
  }
}

function validateOrderFile(file: Pick<File, 'name' | 'size'>) {
  return validateFile(file, 'order');
}

/**
 * 解析订单 CSV（表头行 + 数据行），供上传后自动回填产品名/数量。
 * 表头如：订单号,项目号,产品名称,数量,单位,交期
 */
async function parseOrderCsv(
  file: File,
): Promise<{ orderNo?: string; productName?: string; qty?: string } | null> {
  if (!/\.csv$/i.test(file.name)) return null;
  let text = '';
  try {
    text = await file.text();
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return null;
  const firstLine = lines[0];
  const secondLine = lines[1];
  if (!firstLine || !secondLine) return null;
  const header = firstLine.replace(/^\uFEFF/, '').split(',').map((h) => h.trim());
  const row = secondLine.split(',');
  const indexOf = (name: string) => header.findIndex((h) => h === name);
  const cell = (idx: number): string | undefined => {
    if (idx < 0 || idx >= row.length) return undefined;
    const value = row[idx];
    return value === undefined ? undefined : value.trim();
  };
  return {
    orderNo: cell(indexOf('订单号')),
    productName: cell(indexOf('产品名称')),
    qty: cell(indexOf('数量')),
  };
}

/** 从 M1 预识别结果提取订单头信息（产品名/数量/订单号），供回填输入框。 */
function extractM1Preflight(detail: M1IngestDetail): {
  orderNo?: string;
  productName?: string;
  qty?: string;
} {
  const doc = detail.document;
  if (!doc || typeof doc !== 'object') return {};
  const lines = (doc as { lines?: unknown }).lines;
  if (!Array.isArray(lines) || lines.length === 0) return {};
  const line = lines[0];
  if (!line || typeof line !== 'object') return {};
  const row = line as Record<string, unknown>;
  const name =
    String(row.name_raw ?? row.name_normalized ?? row.full_product_name ?? row.product_name ?? '').trim() ||
    undefined;
  const qtyRaw = row.quantity ?? row.order_qty ?? row.qty;
  const orderNo = String(row.customer_order_number ?? row.order_number ?? '').trim() || undefined;
  let qty: string | undefined;
  if (qtyRaw !== undefined && qtyRaw !== null && String(qtyRaw).trim() !== '') {
    qty = String(qtyRaw).trim();
  }
  return { orderNo, productName: name, qty };
}

type OrderFileUploadPanelProps = {
  onRunProgress?: (progress: BusinessFlowRunProgress) => void;
  onClose?: () => void;
  initialFiles?: File[];
};

type RunPhase = 'idle' | 'recognizing' | 'running' | 'attention' | 'done' | 'failed';

export function OrderFileUploadPanel({ onRunProgress, onClose, initialFiles }: OrderFileUploadPanelProps) {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [orderType, setOrderType] = useState<'normal' | 'pre_order' | 'sample'>('normal');
  const [historyBomPath, setHistoryBomPath] = useState('');
  const [productNameInput, setProductNameInput] = useState('');
  const [orderQtyInput, setOrderQtyInput] = useState('');
  const [submittedOrderId, setSubmittedOrderId] = useState<string | null>(null);
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [runProgress, setRunProgress] = useState<BusinessFlowRunProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [m1Preflight, setM1Preflight] = useState<{
    status: 'idle' | 'recognizing' | 'done' | 'failed';
    detail?: M1IngestDetail;
    message?: string;
  }>({ status: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  const nativeFile = useMemo(
    () => fileList.map((file) => file.originFileObj as File | undefined).find(Boolean),
    [fileList],
  );

  const catalogConfigsQuery = useQuery({
    queryKey: ['business-catalog-run-configs'],
    queryFn: getCatalogRunConfigs,
    staleTime: 300_000,
    enabled: import.meta.env.VITE_LOCAL_LANGGRAPH !== 'true',
  });

  const productNameOptions = useMemo(() => {
    if (!nativeFile) return [];
    const hint = buildOrderNameHint(catalogConfigsQuery.data ?? [], nativeFile.name);
    return hint ? [{ value: hint }] : [];
  }, [nativeFile, catalogConfigsQuery.data]);

  // 上传 CSV 订单后自动回填产品名/数量，并推断历史 BOM 路径：
  // CAND-{NNN}_订单.csv → /srv/yunpai-business-tracking/history-bom/CAND-{NNN}_历史BOM.xlsx。
  // 只回填未手动填写的输入，避免覆盖用户输入；非 CSV 订单仍可手动填写。
  useEffect(() => {
    const file = nativeFile;
    if (!file) return;
    let cancelled = false;
    void parseOrderCsv(file).then((parsed) => {
      if (cancelled || !parsed) return;
      if (parsed.productName) {
        setProductNameInput((prev) => prev || (parsed.productName as string));
      }
      if (parsed.qty) {
        setOrderQtyInput((prev) => prev || (parsed.qty as string));
      }
      const bomMatch = file.name.match(/^CAND-(\d+)_订单\.csv$/i);
      if (bomMatch) {
        setHistoryBomPath(
          (prev) =>
            prev ||
            `/srv/yunpai-business-tracking/history-bom/CAND-${bomMatch[1]}_历史BOM.xlsx`,
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [nativeFile]);

  // 非 CSV 订单（PDF/PNG/JPG/XLSX 等）选中后自动调 M1 预识别，把识别出的
  // 产品名/数量回填输入框（只覆盖未手填字段），供用户确认后提交。
  useEffect(() => {
    const file = nativeFile;
    if (!file) return;
    if (import.meta.env.VITE_LOCAL_LANGGRAPH === 'true') return;
    if (/\.csv$/i.test(file.name)) return; // CSV 走 parseOrderCsv 客户端解析
    let cancelled = false;
    const controller = new AbortController();
    setM1Preflight({ status: 'recognizing' });
    setPhase('recognizing');
    void (async () => {
      try {
        const detail = await uploadOrderFile({ file, signal: controller.signal });
        if (cancelled) return;
        const terminal =
          detail.status === 'done' ||
          detail.status === 'needs_review' ||
          detail.status === 'failed' ||
          detail.status === 'cancelled';
        const settled = terminal ? detail : await waitForM1Task(detail.task_id, { signal: controller.signal });
        if (cancelled) return;
        if (settled.status === 'failed' || settled.status === 'cancelled') {
          setM1Preflight({ status: 'failed', message: settled.error ?? 'M1 预识别失败' });
          setPhase('idle');
          return;
        }
        setM1Preflight({ status: 'done', detail: settled });
        setPhase('idle');
        const extracted = extractM1Preflight(settled);
        if (extracted.productName) {
          setProductNameInput((prev) => prev || (extracted.productName as string));
        }
        if (extracted.qty) {
          setOrderQtyInput((prev) => prev || (extracted.qty as string));
        }
        if (extracted.orderNo) {
          setHistoryBomPath((prev) => {
            if (prev) return prev;
            // 支持 SO-HIST-CAND-20260724-091（→091）与 CAND-091（→091）：
            // 优先取 CAND-{日期}-{序号} 的序号，否则取 CAND-{NNN}。
            const orderNo = extracted.orderNo ?? '';
            const withSeq = orderNo.match(/CAND-(\d+)-(\d+)$/i);
            const plain = orderNo.match(/CAND-(\d+)$/i);
            const bomMatch = withSeq ?? plain;
            return bomMatch
              ? `/srv/yunpai-business-tracking/history-bom/CAND-${bomMatch[withSeq ? 2 : 1]}_历史BOM.xlsx`
              : prev;
          });
        }
      } catch (cause) {
        if (cancelled) return;
        const text = cause instanceof Error ? cause.message : String(cause);
        setM1Preflight({ status: 'failed', message: `M1 预识别失败：${text}` });
        setPhase('idle');
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [nativeFile]);

  useEffect(() => {
    if (!initialFiles || initialFiles.length === 0) return;
    const last = initialFiles[initialFiles.length - 1];
    if (!last) return;
    // 全局拖拽/粘贴进入的文件绕过了 Upload 的 beforeUpload，这里补一次同口径大小校验，
    // 超限文件（含压缩包）在上传前就被拦截并给出明确提示。
    // 注意：只校验大小、不做扩展名判定——已显式打开弹窗时拖入的文件按 main 行为
    // 不再按扩展名重新分类（如 M0-only 的 .dwg 保留在订单弹窗内），扩展名由
    // 弹窗内 beforeUpload 与提交时服务端把关。
    if (last.size / 1024 / 1024 > MAX_ORDER_FILE_MB) {
      void message.error(`订单文件过大：超过 ${MAX_ORDER_FILE_MB}MB，请拆分后上传`);
      return;
    }
    setFileList([
      {
        uid: `drop-${Date.now()}`,
        name: last.name,
        size: last.size,
        type: last.type,
        originFileObj: last as unknown as UploadFile['originFileObj'],
      },
    ]);
  }, [initialFiles]);

  const beforeUpload = (file: File) => {
    if (import.meta.env.VITE_LOCAL_LANGGRAPH === 'true' && /\.json$/i.test(file.name)) {
      return false;
    }
    const validationError = validateOrderFile(file);
    if (validationError) {
      void message.error(validationError);
      return Upload.LIST_IGNORE;
    }
    return false;
  };

  const reset = () => {
    abortRef.current?.abort();
    setPhase('idle');
    setRunProgress(null);
    setError(null);
    setM1Preflight({ status: 'idle' });
    setFileList([]);
  };

  /** 失败必须同时落到全局运行 store：弹窗在提交后已关闭（组件卸载），
   *  仅 setState 会让主面板停留在“运行中”假象（用户看到卡死）。 */
  const failRun = (cause: unknown, fallbackTitle: string) => {
    const { title, message: messageText } = describeRunFailure(cause, fallbackTitle);
    setError(messageText);
    const failedProgress: BusinessFlowRunProgress = {
      phase: 'failed',
      title,
      detail: messageText,
      failed: true,
      error: messageText,
    };
    setRunProgress(failedProgress);
    setPhase('failed');
    useBusinessRunStore.getState().update(failedProgress);
    void message.error(messageText);
  };

  const handleSubmit = async () => {
    const file = nativeFile;
    if (!file) {
      void message.warning('请先选择订单文件');
      return;
    }
    // 提交前兜底校验：与 beforeUpload/initialFiles 同一口径（含压缩包按压缩后大小）。
    if (file.size / 1024 / 1024 > MAX_ORDER_FILE_MB) {
      void message.warning(`订单文件过大：超过 ${MAX_ORDER_FILE_MB}MB，请拆分后上传`);
      return;
    }
    const orderQty = positiveQuantity(orderQtyInput);
    if (orderQty === undefined) {
      void message.warning('未识别到订单数量，请填写大于 0 的数量后提交');
      return;
    }
    setError(null);
    setPhase('running');
    const conversationId = currentConversationId();

    if (import.meta.env.VITE_LOCAL_LANGGRAPH === 'true') {
      const prompt = `请根据订单执行采购和排程全流程：解析订单文件 ${file.name}${productNameInput.trim() ? `，产品名为${productNameInput.trim()}` : ''}${orderQty ? `，数量为${orderQty}` : ''}`;
      try {
        const contentB64 = await fileToBase64(file);
        let document: Record<string, unknown> | undefined;
        if (/\.json$/i.test(file.name)) {
          try {
            const parsed = JSON.parse(await file.text()) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) document = parsed as Record<string, unknown>;
          } catch {
            // JSON 文件解析失败时仍保留原始附件，让后端按文件内容处理并在 Gate 提示缺失字段。
          }
        }
        const orderId = String(
          document?.order_id ?? document?.order_number ?? document?.customer_order_number ?? file.name,
        ).trim() || file.name;
        rememberLocalOrder({
          orderId,
          filename: file.name,
          productName: String(document?.product_name ?? '').trim() || productNameInput.trim() || undefined,
          quantity: orderQty,
          dueDate: typeof document?.due_date === 'string' ? document.due_date : undefined,
          conversationId: currentConversationId(),
        });
        onClose?.();
        const workflowFields = document
          ? {
              workflow: 'm1_m5_document_to_plan',
              product: { product_code: document.product_code, product_name: document.product_name ?? (productNameInput.trim() || file.name) },
              ...(Array.isArray(document.bom_lines) ? { bom_lines: document.bom_lines } : {}),
              ...(Array.isArray(document.routing_steps) ? { routing_steps: document.routing_steps } : {}),
              ...(Array.isArray(document.inventory) ? { inventory: document.inventory } : {}),
              ...(Array.isArray(document.resources) ? { resources: document.resources } : {}),
            }
          : { workflow: 'm1_m5_document_to_plan' };
        await useChatStore.getState().sendMessage(prompt, undefined, undefined, {
          ...(document ? { document } : {}),
          ...workflowFields,
          documents: [{ kind: 'order', filename: file.name, content_type: file.type || 'application/octet-stream', content_b64: contentB64 }],
        });
        setPhase('done');
      } catch (cause) {
        const text = cause instanceof Error ? cause.message : String(cause);
        setError(text);
        setPhase('failed');
      }
      return;
    }

    useBusinessRunStore.getState().begin({ orderId: file.name, productName: file.name }, conversationId);
    // 上传订单同步为当前选中订单：否则 DataFlowPanel 顶部订单选择器仍显示
    // 上一次选中的受控订单（如 CAND-088），面板标题与本次 run 不一致。
    const uploadCatalogId = `upload-${file.name}-${file.size}`;
    useBusinessRunStore.getState().setSelectedCatalogId(uploadCatalogId);
    localStorage.setItem('yunpai-business-flow-selected-order', uploadCatalogId);
    // 提交后立即关闭上传弹窗，让主面板展示流程进度与人工闸门
    onClose?.();
    const controller = new AbortController();
    abortRef.current = controller;
    setSubmittedOrderId(file.name);
    try {
      const progress = await runBusinessFlow(
        {
          catalogId: uploadCatalogId,
          orderId: file.name,
          orderNumber: file.name,
          orderType,
          productName: productNameInput.trim() || file.name,
          orderQty,
          orderFile: file,
          orderFilename: file.name,
          historyBomPath: historyBomPath.trim() || undefined,
          mode: 'real',
        },
        {
          signal: controller.signal,
          onProgress: (next) => {
            if (!isCurrentConversation(conversationId)) return;
            setRunProgress(next);
            useBusinessRunStore.getState().update(next);
            if (next.trackingTaskId) {
              registerFlowRun(uploadCatalogId, next.trackingTaskId, next.runId);
            }
            onRunProgress?.(next);
          },
        },
      );
      setRunProgress(progress);
      if (progress.phase === 'done') {
        setPhase('done');
      } else if (
        progress.phase === 'human_input_required' ||
        progress.phase === 'blocked' ||
        progress.phase === 'data_incomplete'
      ) {
        setPhase('attention');
      } else {
        setError(progress.error ?? progress.detail);
        setPhase('failed');
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        return;
      }
      failRun(cause, '业务流程运行失败');
    }
  };

  const handleResume = async () => {
    const runId = runProgress?.runId;
    if (!runId) {
      return;
    }
    setError(null);
    setPhase('running');
    const conversationId = currentConversationId();
    useBusinessRunStore.getState().begin({ orderId: submittedOrderId ?? undefined, productName: submittedOrderId ?? undefined }, conversationId);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const progress = await resumeBusinessFlow(
        runId,
        {
          signal: controller.signal,
          orderId: submittedOrderId ?? undefined,
          onProgress: (next) => {
            if (!isCurrentConversation(conversationId)) return;
            setRunProgress(next);
            useBusinessRunStore.getState().update(next);
            onRunProgress?.(next);
          },
        },
      );
      setRunProgress(progress);
      if (progress.phase === 'done') {
        setPhase('done');
      } else if (
        progress.phase === 'human_input_required' ||
        progress.phase === 'blocked' ||
        progress.phase === 'data_incomplete'
      ) {
        setPhase('attention');
      } else {
        setError(progress.error ?? progress.detail);
        setPhase('failed');
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        return;
      }
      failRun(cause, '继续运行失败');
    }
  };

  return (
    <Space direction="vertical" size={8} className={styles.stack}>
      <div className={styles.intro}>
        <span>上传订单文件 · 服务器执行受治理流程</span>
        <span className={styles.introHint}>正式订单走 订单到排程；预订单/样品单走独立打样流程（不进入正式排程与采购）</span>
      </div>

      <Segmented
        className="order-type-selector"
        block
        value={orderType}
        onChange={(value) => setOrderType(value as 'normal' | 'pre_order' | 'sample')}
        options={[
          { label: '正式订单', value: 'normal' },
          { label: '预订单', value: 'pre_order' },
          { label: '样品单', value: 'sample' },
        ]}
      />

      <Upload.Dragger
        className="order-upload-panel"
        disabled={phase === 'running'}
        maxCount={1}
        accept={ORDER_EXTENSIONS.map((ext) => `.${ext}`).join(',')}
        beforeUpload={beforeUpload}
        fileList={fileList}
        onChange={({ fileList: next }) => setFileList(next.slice(-1))}
        onRemove={reset}
      >
        <p className="ant-upload-drag-icon"><UploadOutlined /></p>
        <p className="ant-upload-text">拖拽订单文件到此处，或点击选择</p>
        <p className="ant-upload-hint">支持 {ORDER_EXTENSIONS.join('/')} · 单文件上限 {MAX_ORDER_FILE_MB}MB</p>
      </Upload.Dragger>

      {m1Preflight.status === 'recognizing' ? (
        <Alert
          type="info"
          showIcon
          icon={<LoadingOutlined />}
          message="正在识别订单内容…"
          description="PDF/图片订单将先经 M0 解析出产品名/数量，识别完成后请确认无误再提交。"
        />
      ) : null}
      {m1Preflight.status === 'done' ? (
        <Alert
          type="success"
          showIcon
          message="已识别订单内容，请确认后提交"
          description={`识别结果：${productNameInput || '（未识别到产品名）'}${
            orderQtyInput ? `，数量 ${orderQtyInput}` : ''
          }。可修改下方输入框后提交。`}
        />
      ) : null}
      {m1Preflight.status === 'failed' ? (
        <Alert
          type="warning"
          showIcon
          message="订单内容预识别未完成"
          description={`${m1Preflight.message ?? '识别失败'}；可手动填写产品名/数量后提交，或更换文件。`}
        />
      ) : null}

      {phase === 'idle' ? (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <AutoComplete
            value={productNameInput}
            onChange={setProductNameInput}
            options={productNameOptions}
            placeholder="产品名称（可选，填真实名称可提升历史 BOM 匹配）"
            allowClear
            style={{ width: '100%', minWidth: 0, maxWidth: '100%' }}
          />
          <Input
            aria-label="订单数量"
            type="number"
            min={1}
            value={orderQtyInput}
            onChange={(event) => setOrderQtyInput(event.target.value)}
            placeholder="订单数量（必填）"
            allowClear
          />
          <Input
            value={historyBomPath}
            onChange={(event) => setHistoryBomPath(event.target.value)}
            placeholder="历史 BOM 路径（可选），如 /srv/yunpai-business-tracking/history-bom/CAND-088_历史BOM.xlsx"
            allowClear
          />
        </Space>
      ) : null}

      {phase === 'running' ? (
        <Alert
          type="info"
          showIcon
          icon={<LoadingOutlined />}
          message={runProgress?.title ?? '正在执行受治理业务流程'}
          description={runProgress?.detail ?? '服务器 LangGraph 正在执行并持久化追踪记录…'}
        />
      ) : null}
      {phase === 'done' ? (
        <Alert
          type="success"
          showIcon
          message={runProgress?.title ?? '订单到排程 链路已完成'}
          description={
            <>
              {runProgress?.detail}
              {runProgress?.trackingTaskId ? <TaskId value={runProgress.trackingTaskId} /> : null}
            </>
          }
        />
      ) : null}
      {phase === 'attention' ? (
        <Alert
          type="warning"
          showIcon
          message={runProgress?.title ?? '流程需要人工处理'}
          description={
            <>
              {runProgress?.detail}
              {runProgress?.trackingTaskId ? <TaskId value={runProgress.trackingTaskId} /> : null}
            </>
          }
        />
      ) : null}
      {phase === 'attention' && runProgress?.runId && !runProgress.gate ? (
        <div className={styles.actions}>
          <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => void handleResume()}>
            继续运行
          </Button>
        </div>
      ) : null}
      {phase === 'failed' ? <Alert type="error" showIcon message={error ?? '操作失败'} /> : null}

      {phase === 'idle' && nativeFile ? (
        <div className={styles.actions}>
          <Button type="primary" icon={<CloudUploadOutlined />} onClick={() => void handleSubmit()}>
            提交受治理流程
          </Button>
        </div>
      ) : null}
      {phase !== 'idle' && phase !== 'running' ? <Button onClick={reset}>重新上传</Button> : null}
    </Space>
  );
}
