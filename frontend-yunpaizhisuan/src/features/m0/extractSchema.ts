/**
 * M0 文档提取结果解析工具。
 *
 * extract_content 为 M1 返回的 JSON 文本（T1.0 定稿 schema 前的容错解析）：
 * - 支持单对象、数组、{ items/rows/data/list } 包裹；
 * - 字段名兼容英文（order_no）与中文（订单号）两种形态；
 * - 解析失败按纯文本展示，不阻塞前端。
 */

export type ExtractStatusKind =
  | 'empty'
  | 'queued'
  | 'extracting'
  | 'done'
  | 'failed'
  | 'needs_review'
  | 'skipped'
  | 'unknown';

export type NormalizedExtractStatus = {
  kind: ExtractStatusKind;
  reason?: string;
};

const QUEUED_WORDS = new Set(['created', 'queued', 'pending', 'scheduled', 'submitted']);
const EXTRACTING_WORDS = new Set(['extracting', 'processing', 'running', 'in_progress', 'working']);
const DONE_WORDS = new Set(['done', 'success', 'succeeded', 'completed', 'ok', 'extracted', 'agent_complete']);
const REVIEW_WORDS = new Set(['needs_review', 'review', 'needs_manual', 'needs_confirmation', 'agent_needs_review']);
const SKIPPED_WORDS = new Set(['skipped', 'skip', 'not_applicable']);

export function normalizeExtractStatus(raw: string | null | undefined): NormalizedExtractStatus {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) {
    return { kind: 'empty' };
  }
  if (value.startsWith('failed')) {
    const reason = (raw ?? '').split(':').slice(1).join(':').trim() || raw || undefined;
    return { kind: 'failed', reason };
  }
  const exact = value.replace(/[_\-\s]/g, '');
  if (QUEUED_WORDS.has(exact) || QUEUED_WORDS.has(value)) return { kind: 'queued' };
  if (EXTRACTING_WORDS.has(exact) || EXTRACTING_WORDS.has(value)) return { kind: 'extracting' };
  if (DONE_WORDS.has(exact) || DONE_WORDS.has(value)) return { kind: 'done' };
  if (REVIEW_WORDS.has(exact) || REVIEW_WORDS.has(value)) return { kind: 'needs_review' };
  if (SKIPPED_WORDS.has(exact) || SKIPPED_WORDS.has(value)) return { kind: 'skipped' };
  return { kind: 'unknown' };
}

export function parseExtractContent(raw: string | null | undefined): unknown {
  const value = (raw ?? '').trim();
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isNonEmpty = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
};

const keyMatches = (key: string, candidate: string): boolean => {
  const a = key.toLowerCase().replace(/[_\-\s]/g, '');
  const b = candidate.toLowerCase().replace(/[_\-\s]/g, '');
  return a === b;
};

/**
 * 深度查找第一个命中的候选字段（单对象优先，其次数组/嵌套对象）。
 */
export function pickField(source: unknown, candidates: string[]): unknown {
  if (!isObject(source)) return undefined;
  for (const key of Object.keys(source)) {
    if (candidates.some((candidate) => keyMatches(key, candidate)) && isNonEmpty(source[key])) {
      return source[key];
    }
  }
  for (const value of Object.values(source)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = pickField(item, candidates);
        if (isNonEmpty(found)) return found;
      }
    } else if (isObject(value)) {
      const found = pickField(value, candidates);
      if (isNonEmpty(found)) return found;
    }
  }
  return undefined;
}

const ROW_BAG_KEYS = ['items', 'rows', 'lines', 'data', 'list', 'records', 'details', 'materials', 'params', 'parameters'];

export function extractRows(source: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(source)) {
    return source.filter(isObject);
  }
  if (!isObject(source)) return [];
  for (const key of ROW_BAG_KEYS) {
    const value = source[key];
    if (Array.isArray(value)) {
      return value.filter(isObject);
    }
  }
  return [];
}

export function formatExtractValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export type OrderExtract = {
  orderNo?: string;
  product?: string;
  qty?: string;
  dueDate?: string;
  customer?: string;
};

export type BomRowExtract = {
  materialCode?: string;
  materialName?: string;
  qty?: string;
  lossRate?: string;
};

export type BomExtract = {
  model?: string;
  rows: BomRowExtract[];
};

export type DrawingExtract = {
  drawingNo?: string;
  partNo?: string;
  customerPartNo?: string;
  title?: string;
  drawingType?: string;
};

export type SopRowExtract = {
  process?: string;
  step?: string;
  content?: string;
  params?: string;
};

export type SpecRowExtract = {
  name?: string;
  value?: string;
  unit?: string;
};

export type PoRowExtract = {
  material?: string;
  qty?: string;
  dueDate?: string;
};

export type PoExtract = {
  poNo?: string;
  supplier?: string;
  rows: PoRowExtract[];
};

export type GenericField = {
  key: string;
  value: string;
};

export type ExtractedResult =
  | { kind: 'order'; data: OrderExtract }
  | { kind: 'bom'; data: BomExtract }
  | { kind: 'drawing'; data: DrawingExtract }
  | { kind: 'sop'; data: SopRowExtract[] }
  | { kind: 'specification'; data: SpecRowExtract[] }
  | { kind: 'po'; data: PoExtract }
  | { kind: 'generic'; data: GenericField[] }
  | { kind: 'text'; data: string }
  | { kind: 'empty' };

const ORDER_FIELDS: Record<keyof OrderExtract, string[]> = {
  orderNo: ['doc_no', 'order_no', 'order_number', 'order_id', '订单号', '订单编号', '单号', '客户订单号'],
  product: ['product', 'product_name', 'model', 'product_model', '产品', '产品名称', '品名', '型号'],
  qty: ['qty', 'quantity', '数量', '订货数量'],
  dueDate: ['due_date', 'delivery_date', 'delivery_time', '交期', '交货日期', '交货期', '交货时间', '交期日期', '日期'],
  customer: ['customer', 'customer_name', '客户', '客户名称', '客户名'],
};

const BOM_MODEL_FIELDS = ['model', 'finished_model', 'product_model', '成品型号', '成品编码', '产品型号', '机型', '型号', '母件编码'];
const BOM_ROW_FIELDS: Array<[keyof BomRowExtract, string[]]> = [
  ['materialCode', ['material_code', 'material', '物料编码', '物料代码', '料号', '编码', '物料编号', '子件编码']],
  ['materialName', ['material_name', '物料名称', '品名', '物料', '名称']],
  ['qty', ['qty', 'quantity', 'qty_per', '用量', '数量', '单机用量', '需求数量']],
  ['lossRate', ['loss_rate', '损耗率', '损耗', '损耗比例']],
];

const DRAWING_FIELDS: Record<keyof DrawingExtract, string[]> = {
  drawingNo: ['drawing_no', 'drawing_number', 'drawing_id', '图纸编号', '图号', '编号', '图纸号'],
  partNo: ['part_no', '品名料号', '料号', '产品料号'],
  customerPartNo: ['customer_part_no', '客户料号'],
  title: ['title', 'drawing_title', '图纸标题', '标题', '图名', '名称', '品名'],
  drawingType: ['drawing_type', 'type', '图纸类型', '类型', '图类'],
};

const SOP_ROW_FIELDS: Array<[keyof SopRowExtract, string[]]> = [
  ['process', ['process', 'process_name', '工序', '工序名称', '工序编号', '工位']],
  ['step', ['step', 'step_name', '工步', '步骤', '工步名称', '作业步骤']],
  ['content', ['content', '作业内容', '内容', '作业说明', '操作内容', '操作说明', '要求']],
  ['params', ['params', 'parameters', '参数', '工艺参数', '参数要求', '规格参数']],
];

const SPEC_ROW_FIELDS: Array<[keyof SpecRowExtract, string[]]> = [
  ['name', ['name', 'param_name', 'parameter', '参数', '参数名称', '项目', '规格项', '规格名称', '项目名称']],
  ['value', ['value', 'param_value', '参数值', '规格值', '数值', '要求', '标准值', '内容']],
  ['unit', ['unit', 'uom', '单位', '规格单位']],
];

const PO_HEADER_FIELDS: Record<'poNo' | 'supplier', string[]> = {
  poNo: ['doc_no', 'po_no', 'po_number', 'po', '采购单号', '采购订单号', '单号', '订单号', 'PO号'],
  supplier: ['supplier', 'supplier_name', 'vendor', '供应商', '供应商名称', '供应商名'],
};

const PO_ROW_FIELDS: Array<[keyof PoRowExtract, string[]]> = [
  ['material', ['material', 'material_name', 'item', 'model', '物料', '物料名称', '品名', '物料编码', '料号']],
  ['qty', ['qty', 'quantity', '数量', '订货数量', '采购数量']],
  ['dueDate', ['due_date', 'delivery_date', '交期', '交货日期', '交货期', '日期']],
];

const rowValue = (row: Record<string, unknown>, candidates: string[]): string =>
  formatExtractValue(pickField(row, candidates));

export function extractOrder(source: unknown): OrderExtract {
  return {
    orderNo: formatExtractValue(pickField(source, ORDER_FIELDS.orderNo)),
    product: formatExtractValue(pickField(source, ORDER_FIELDS.product)),
    qty: formatExtractValue(pickField(source, ORDER_FIELDS.qty)),
    dueDate: formatExtractValue(pickField(source, ORDER_FIELDS.dueDate)),
    customer: formatExtractValue(pickField(source, ORDER_FIELDS.customer)),
  };
}

export function extractBom(source: unknown): BomExtract {
  const rows = extractRows(source).map((row) => {
    const out: BomRowExtract = {};
    for (const [key, candidates] of BOM_ROW_FIELDS) {
      out[key] = rowValue(row, candidates);
    }
    return out;
  });
  return {
    model: formatExtractValue(pickField(source, BOM_MODEL_FIELDS)),
    rows,
  };
}

export function extractDrawing(source: unknown): DrawingExtract {
  const data: DrawingExtract = {
    drawingNo: formatExtractValue(pickField(source, DRAWING_FIELDS.drawingNo)),
    partNo: formatExtractValue(pickField(source, DRAWING_FIELDS.partNo)),
    customerPartNo: formatExtractValue(pickField(source, DRAWING_FIELDS.customerPartNo)),
    title: formatExtractValue(pickField(source, DRAWING_FIELDS.title)),
    drawingType: formatExtractValue(pickField(source, DRAWING_FIELDS.drawingType)),
  };
  if (!data.title) {
    data.title = data.partNo || data.customerPartNo;
  }
  return data;
}

export function extractSop(source: unknown): SopRowExtract[] {
  return extractRows(source).map((row) => {
    const out: SopRowExtract = {};
    for (const [key, candidates] of SOP_ROW_FIELDS) {
      out[key] = rowValue(row, candidates);
    }
    return out;
  });
}

export function extractSpecification(source: unknown): SpecRowExtract[] {
  const rows = extractRows(source).map((row) => {
    const out: SpecRowExtract = {};
    for (const [key, candidates] of SPEC_ROW_FIELDS) {
      out[key] = rowValue(row, candidates);
    }
    return out;
  });
  if (rows.length > 0) {
    return rows;
  }
  // T1.0 规格书 schema：header 直接挂关键字段（品名规格/型号/芯线数/导体/绝缘体/绞距…）
  const headerFields: Array<[string, string[]]> = [
    ['品名规格', ['product_spec', '品名规格', '品名']],
    ['型号', ['model', '型号']],
    ['规格', ['spec', '规格']],
    ['芯线数', ['core_count', '芯线数']],
    ['导体', ['conductor', '导体']],
    ['绝缘体', ['insulation', '绝缘体']],
    ['绞距', ['twist_pitch', '绞距']],
  ];
  return headerFields
    .map(([label, candidates]) => {
      const value = formatExtractValue(pickField(source, candidates));
      return value ? { name: label, value, unit: '' } : null;
    })
    .filter((item) => item !== null) as SpecRowExtract[];
}

export function extractPo(source: unknown): PoExtract {
  const rows = extractRows(source).map((row) => {
    const out: PoRowExtract = {};
    for (const [key, candidates] of PO_ROW_FIELDS) {
      out[key] = rowValue(row, candidates);
    }
    return out;
  });
  return {
    poNo: formatExtractValue(pickField(source, PO_HEADER_FIELDS.poNo)),
    supplier: formatExtractValue(pickField(source, PO_HEADER_FIELDS.supplier)),
    rows,
  };
}

export function extractGeneric(source: unknown): GenericField[] {
  const flatten = (value: unknown, prefix = ''): GenericField[] => {
    if (isObject(value)) {
      return Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key));
    }
    if (Array.isArray(value)) {
      return value.flatMap((item, index) => flatten(item, `${prefix}[${index}]`));
    }
    const text = formatExtractValue(value);
    return text ? [{ key: prefix, value: text }] : [];
  };
  return flatten(source);
}

export function extractForDomain(domain: string, rawContent: string | null | undefined): ExtractedResult {
  const parsed = parseExtractContent(rawContent);
  if (parsed === null || parsed === undefined || parsed === '') {
    return { kind: 'empty' };
  }
  if (typeof parsed === 'string') {
    return parsed.trim() ? { kind: 'text', data: parsed } : { kind: 'empty' };
  }
  switch (domain) {
    case 'order':
      return { kind: 'order', data: extractOrder(parsed) };
    case 'bom':
      return { kind: 'bom', data: extractBom(parsed) };
    case 'drawing':
    case 'id_drawing':
      return { kind: 'drawing', data: extractDrawing(parsed) };
    case 'sop':
      return { kind: 'sop', data: extractSop(parsed) };
    case 'specification':
      return { kind: 'specification', data: extractSpecification(parsed) };
    case 'po':
    case 'purchase_request':
    case 'purchase_receipt':
      return { kind: 'po', data: extractPo(parsed) };
    default:
      return { kind: 'generic', data: extractGeneric(parsed) };
  }
}

export type ExtractSummary = {
  total: number;
  done: number;
  failed: number;
  reviewing: number;
  active: number;
  skipped: number;
  empty: number;
  hasExtractable: boolean;
  kind: 'idle' | 'active' | 'done' | 'failed' | 'review';
};

export function summarizeExtraction(documents: Array<{ extract_status?: string }>): ExtractSummary {
  const summary: ExtractSummary = {
    total: documents.length,
    done: 0,
    failed: 0,
    reviewing: 0,
    active: 0,
    skipped: 0,
    empty: 0,
    hasExtractable: false,
    kind: 'idle',
  };
  for (const doc of documents) {
    const status = normalizeExtractStatus(doc.extract_status);
    switch (status.kind) {
      case 'done':
        summary.done += 1;
        break;
      case 'failed':
        summary.failed += 1;
        break;
      case 'needs_review':
        summary.reviewing += 1;
        break;
      case 'skipped':
        summary.skipped += 1;
        break;
      case 'empty':
      case 'queued':
      case 'extracting':
      case 'unknown':
        summary.active += 1;
        break;
    }
  }
  summary.hasExtractable = summary.done > 0 || summary.failed > 0 || summary.reviewing > 0 || summary.active > 0;
  if (summary.failed > 0) summary.kind = 'failed';
  else if (summary.active > 0) summary.kind = 'active';
  else if (summary.reviewing > 0) summary.kind = 'review';
  else if (summary.done > 0) summary.kind = 'done';
  return summary;
}

export function extractPollIntervalMs(documents: Array<{ extract_status?: string }>): number | false {
  const active = documents.some((doc) => {
    const kind = normalizeExtractStatus(doc.extract_status).kind;
    return kind === 'empty' || kind === 'queued' || kind === 'extracting' || kind === 'unknown';
  });
  return active ? 2000 : false;
}
