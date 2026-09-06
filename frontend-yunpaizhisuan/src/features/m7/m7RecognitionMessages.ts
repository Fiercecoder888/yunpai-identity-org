const FIELD_LABELS: Record<string, string> = {
  delivery_note_number: '送货单号',
  supplier_id: '供应商内部编号',
  supplier_delivery_number: '供应商送货单号',
  purchase_order_id: '采购订单内部编号',
  order_id: '生产订单内部编号',
  warehouse_id: '仓库内部编号',
  items: '物料明细',
  purchase_order_item_id: '采购订单行内部编号',
  material_id: '物料内部编号',
  material_code: '物料编码',
  material_name: '物料名称',
  batch_no: '批次号',
  quantity: '数量',
  uom: '单位',
  line_no: '行号',
};

const REFERENCE_LABELS: Record<string, string> = {
  supplier_code: '供应商编码',
  supplier_name: '供应商名称',
  purchase_order_number: '采购单号',
  order_number: '订单号',
  warehouse_code: '仓库编码',
  warehouse_name: '仓库名称',
};

const itemFieldPattern = /^items\[(\d+)]\.(.+)$/;
const rowReviewPattern = /^row_(.+)_requires_review$/;
const documentContentPattern = /^document_(.+)_has_no_structured_content$/;

export function formatM7MissingField(field: string): string {
  const itemField = itemFieldPattern.exec(field);
  if (itemField) {
    const itemNumber = Number(itemField[1] ?? 0) + 1;
    const label = FIELD_LABELS[itemField[2] ?? ''] ?? '其他内部字段';
    return `第 ${itemNumber} 条明细的${label}待补充`;
  }
  return `${FIELD_LABELS[field] ?? '其他内部字段'}待补充`;
}

export function formatM7RecognitionWarning(warning: string): string {
  if (warning === 'document_type_not_confirmed_as_purchase_receipt') {
    return '文档类型尚未确认是采购收货单，请人工核对';
  }
  const rowReview = rowReviewPattern.exec(warning);
  if (rowReview) return `数据行 ${rowReview[1]} 需要人工复核`;
  const documentContent = documentContentPattern.exec(warning);
  if (documentContent) return `文件 ${documentContent[1]} 暂无可用的结构化识别结果`;
  return '存在其他识别提示，请人工复核';
}

export function formatM7ReferenceField(key: string, value: unknown): string {
  const label = REFERENCE_LABELS[key] ?? '其他参考信息';
  return `${label}：${String(value)}`;
}

export type M7DeliveryDraft = M7DeliveryScan & {
  tracking_task_id: string;
};

export type M7DeliveryDraftStructuredData = {
  kind: 'm7_delivery_draft';
  draft: Record<string, unknown> | null;
};

type M7ItemSupplement = {
  line_number: number;
  purchase_order_item_id?: string;
  material_id?: string;
  material_code?: string;
  material_name?: string;
  batch_no?: string;
  quantity?: number | string;
  uom?: string;
};

type M7DeliverySupplement = {
  delivery_note_number?: string;
  supplier_id?: string;
  supplier_delivery_number?: string;
  purchase_order_id?: string;
  order_id?: string;
  warehouse_id?: string;
  items?: M7ItemSupplement[];
};

const HEADER_FIELDS = [
  'delivery_note_number',
  'supplier_id',
  'supplier_delivery_number',
  'purchase_order_id',
  'order_id',
  'warehouse_id',
] as const;

const ITEM_FIELDS = [
  'purchase_order_item_id',
  'material_id',
  'material_code',
  'batch_no',
  'quantity',
  'uom',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isM7DeliveryDraft = (value: unknown): value is M7DeliveryDraft =>
  isRecord(value)
  && typeof value.m0_batch_id === 'string'
  && typeof value.tracking_task_id === 'string'
  && isRecord(value.suggested)
  && Array.isArray(value.items)
  && Array.isArray(value.missing_fields)
  && Array.isArray(value.warnings)
  && Array.isArray(value.recognized_document_types)
  && isRecord(value.reference_fields)
  && Array.isArray(value.source_documents)
  && typeof value.requires_human_review === 'boolean';

export const m7DeliveryDraftStructuredData = (draft: M7DeliveryDraft | null): M7DeliveryDraftStructuredData => ({
  kind: 'm7_delivery_draft',
  draft: draft as unknown as Record<string, unknown> | null,
});

export function latestM7DeliveryDraft(
  messages: Array<{ structuredData?: Record<string, unknown> | null }>,
): M7DeliveryDraft | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const structuredData = messages[index]?.structuredData;
    if (!structuredData || structuredData.kind !== 'm7_delivery_draft') continue;
    return isM7DeliveryDraft(structuredData.draft) ? structuredData.draft : null;
  }
  return null;
}

const isPresent = (value: unknown) => value !== undefined && value !== null && String(value).trim().length > 0;

const supplementFromToolResult = (result: unknown): M7DeliverySupplement | null => {
  if (!isRecord(result)) return null;
  const data = isRecord(result.data) ? result.data : result;
  if (!isRecord(data.updates)) return null;
  return data.updates as M7DeliverySupplement;
};

const missingFieldsFor = (suggested: Record<string, unknown>, items: Array<Record<string, unknown>>): string[] => {
  const missing = HEADER_FIELDS.filter((field) => !isPresent(suggested[field])) as string[];
  if (items.length === 0) return [...missing, 'items'];
  items.forEach((item, index) => {
    ITEM_FIELDS.forEach((field) => {
      if (!isPresent(item[field])) missing.push(`items[${index}].${field}`);
    });
  });
  return missing;
};

export function applyM7DeliverySupplement(
  draft: M7DeliveryDraft,
  toolResult: unknown,
): M7DeliveryDraft | null {
  const updates = supplementFromToolResult(toolResult);
  if (!updates) return null;

  const suggested = { ...draft.suggested };
  HEADER_FIELDS.forEach((field) => {
    const value = updates[field];
    if (isPresent(value)) suggested[field] = value;
  });

  const items = draft.items.map((item) => ({ ...item }));
  for (const update of updates.items ?? []) {
    if (!Number.isInteger(update.line_number) || update.line_number < 1) continue;
    const index = update.line_number - 1;
    while (items.length <= index) items.push({});
    const item = { ...items[index] };
    ITEM_FIELDS.forEach((field) => {
      const value = update[field];
      if (isPresent(value)) item[field] = value;
    });
    if (isPresent(update.material_name)) item.material_name = update.material_name;
    items[index] = item;
  }

  suggested.items = items;
  return {
    ...draft,
    suggested,
    items,
    missing_fields: missingFieldsFor(suggested, items),
  };
}

export function m7DeliveryDraftChatMessage(draft: M7DeliveryDraft): string {
  if (draft.missing_fields.length === 0) {
    return '送货单文件已经识别完成，必填信息已补齐。请打开手动界面核对识别结果，确认无误后再提交。';
  }

  const headerFields: string[] = [];
  const itemFields = new Map<number, string[]>();
  draft.missing_fields.forEach((field) => {
    const itemField = itemFieldPattern.exec(field);
    if (!itemField) {
      headerFields.push(FIELD_LABELS[field] ?? '其他内部字段');
      return;
    }
    const itemNumber = Number(itemField[1] ?? 0) + 1;
    const labels = itemFields.get(itemNumber) ?? [];
    labels.push(FIELD_LABELS[itemField[2] ?? ''] ?? '其他内部字段');
    itemFields.set(itemNumber, labels);
  });

  const sections: string[] = [];
  if (headerFields.length > 0) {
    sections.push(`基础信息\n${headerFields.map((label) => `- ${label}`).join('\n')}`);
  }
  if (itemFields.size > 0) {
    const itemLines = [...itemFields.entries()]
      .sort(([left], [right]) => left - right)
      .map(([itemNumber, labels]) => `- 第 ${itemNumber} 条明细：${labels.join('、')}`);
    sections.push(`明细信息\n${itemLines.join('\n')}`);
  }

  return [
    '送货单文件已经识别完成。',
    `还需要补充 ${draft.missing_fields.length} 项：`,
    ...sections,
    '请直接用一句话告诉我这些信息，多个字段可以一起说；也可以选择手动补录。',
  ].join('\n\n');
}

export function m7DeliveryDraftContext(draft: M7DeliveryDraft): Record<string, unknown> {
  return {
    m7_delivery_draft: {
      m0_batch_id: draft.m0_batch_id,
      tracking_task_id: draft.tracking_task_id,
      suggested: draft.suggested,
      items: draft.items,
      missing_fields: draft.missing_fields,
    },
  };
}
import type { M7DeliveryScan } from '../../services/m7Api';
