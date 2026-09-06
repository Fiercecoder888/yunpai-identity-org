import type { ChatToolDataRef } from '../../services/chatApi';

/**
 * 从工具结果中镜像后端 `_tool_data_ref` 的启发式提取 data_ref。
 *
 * 流式路径直接使用后端 tool_result 事件携带的 data_ref；本函数仅用于
 * 历史消息重建（safe_result 只存了结果、没有 data_ref），让刷新后预览
 * 按钮依然可用。规则与后端保持一致，避免展示与流式不一致的预览内容。
 */

const BOM_TOOLS = new Set(['generate_m2_bom_controlled', 'run_bom_sop_workflow']);
const SOP_TOOLS = new Set(['generate_m2_sop']);
const DRAWING_TOOLS = new Set(['get_m1_document', 'search_m1_documents']);

const MAX_ROWS = 100;
const MAX_CELL_CHARS = 120;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const nestedGet = (obj: unknown, path: readonly string[]): unknown => {
  let current = obj;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
};

const firstValue = (result: Record<string, unknown>, ...paths: readonly string[][]): unknown => {
  for (const path of paths) {
    const value = nestedGet(result, path);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
};

const boundedRows = (rows: unknown): Array<Record<string, unknown>> | undefined => {
  if (!Array.isArray(rows)) return undefined;
  const bounded: Array<Record<string, unknown>> = [];
  for (const row of rows.slice(0, MAX_ROWS)) {
    if (!isRecord(row)) continue;
    const item: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      item[key] = typeof value === 'string' && value.length > MAX_CELL_CHARS ? `${value.slice(0, MAX_CELL_CHARS)}…` : value;
    }
    bounded.push(item);
  }
  return bounded.length ? bounded : undefined;
};

const firstString = (value: unknown, fallback: string): string => (typeof value === 'string' && value.trim() ? value : fallback);

const bomDataRef = (result: Record<string, unknown>): ChatToolDataRef | undefined => {
  const standardBom = firstValue(
    result,
    ['standard_bom'],
    ['data', 'standard_bom'],
    ['result', 'bom_generation', 'standard_bom'],
    ['bom_generation', 'standard_bom'],
    ['data', 'bom_generation', 'standard_bom'],
  );
  let rows: unknown;
  let header: unknown;
  if (isRecord(standardBom)) {
    rows = standardBom.bom_lines;
    header = standardBom.bom_header;
  } else if (Array.isArray(standardBom)) {
    rows = standardBom;
  } else {
    return undefined;
  }
  const bounded = boundedRows(rows);
  if (!bounded) return undefined;

  let title = 'BOM 明细';
  if (Array.isArray(header) && header.length && isRecord(header[0])) {
    const first = header[0];
    title = firstString(first.bom_id, firstString(first.parent_name, 'BOM 明细'));
  }
  const total = Array.isArray(rows) ? rows.length : bounded.length;
  const summary = `共 ${total} 行 BOM 明细${bounded.length < total ? '（预览前 100 行）' : ''}`;
  return { kind: 'bom', title, summary, rows: bounded };
};

const sopDataRef = (result: Record<string, unknown>): ChatToolDataRef | undefined => {
  const sop = firstValue(
    result,
    ['sop_generation'],
    ['data', 'sop_generation'],
    ['result', 'sop_generation'],
    ['data', 'sop'],
  );
  const sopRecord = isRecord(sop) ? sop : result;

  let rows: unknown;
  for (const key of ['routing_steps', 'bom_items', 'shape_normalization']) {
    const value = sopRecord[key];
    if (Array.isArray(value) && value.length) {
      rows = value;
      break;
    }
  }
  if (rows === undefined) {
    const model = sopRecord.model;
    if (isRecord(model)) {
      const normalization = model.normalization;
      if (isRecord(normalization) && Array.isArray(normalization.shape_normalization) && normalization.shape_normalization.length) {
        rows = normalization.shape_normalization;
      }
    }
  }
  const bounded = boundedRows(rows);
  if (!bounded) return undefined;

  const title = firstString(sopRecord.document_no, `${firstString(sopRecord.product_name, 'SOP')} 参数`);
  const total = Array.isArray(rows) ? rows.length : bounded.length;
  const summary = `共 ${total} 项 SOP 参数${bounded.length < total ? '（预览前 100 项）' : ''}`;
  return { kind: 'sop', title, summary, rows: bounded };
};

const drawingDataRef = (payload: Record<string, unknown>, result: unknown): ChatToolDataRef | undefined => {
  let taskId: unknown;
  let title: unknown;
  if (Array.isArray(result)) {
    const first = result[0];
    if (!isRecord(first)) return undefined;
    taskId = first.task_id;
    title = firstString(first.filename, firstString(first.title, ''));
  } else if (isRecord(result)) {
    taskId = payload.task_id;
    const source = result.source;
    title = isRecord(source) ? firstString(source.original_filename, firstString(result.title, firstString(result.filename, ''))) : '';
  }
  if (typeof taskId !== 'string' || !taskId.trim()) return undefined;
  const safeTitle = firstString(title, '工程图纸');
  return { kind: 'drawing', title: safeTitle, summary: '工程图纸原文件预览', file_url: `/api/m1/files/${taskId}` };
};

/**
 * 从工具名 + 结果提取 data_ref；未识别到结构化数据返回 undefined。
 * @param payload 工具调用参数（drawing 的 file_url 依赖其中的 task_id）
 */
export function extractToolDataRef(tool: string, payload: Record<string, unknown> | undefined, result: unknown): ChatToolDataRef | undefined {
  const safePayload = payload ?? {};
  if (DRAWING_TOOLS.has(tool)) return drawingDataRef(safePayload, result);
  if (!isRecord(result)) return undefined;
  if (BOM_TOOLS.has(tool)) {
    const ref = bomDataRef(result);
    if (ref) return ref;
    return tool === 'run_bom_sop_workflow' ? sopDataRef(result) : undefined;
  }
  if (SOP_TOOLS.has(tool)) return sopDataRef(result);
  return undefined;
}
