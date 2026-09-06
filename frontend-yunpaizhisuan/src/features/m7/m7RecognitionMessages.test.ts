import { describe, expect, it } from 'vitest';
import {
  applyM7DeliverySupplement,
  formatM7MissingField,
  formatM7RecognitionWarning,
  formatM7ReferenceField,
  latestM7DeliveryDraft,
  m7DeliveryDraftChatMessage,
  m7DeliveryDraftContext,
  m7DeliveryDraftStructuredData,
} from './m7RecognitionMessages';

describe('M7 recognition review messages', () => {
  it('translates header and item missing fields into Chinese', () => {
    expect(formatM7MissingField('supplier_id')).toBe('供应商内部编号待补充');
    expect(formatM7MissingField('items[0].purchase_order_item_id')).toBe(
      '第 1 条明细的采购订单行内部编号待补充',
    );
    expect(formatM7MissingField('items[2].material_id')).toBe(
      '第 3 条明细的物料内部编号待补充',
    );
  });

  it('translates recognition warnings without exposing internal English codes', () => {
    expect(formatM7RecognitionWarning('document_type_not_confirmed_as_purchase_receipt')).toBe(
      '文档类型尚未确认是采购收货单，请人工核对',
    );
    expect(formatM7RecognitionWarning('row_7_requires_review')).toBe(
      '数据行 7 需要人工复核',
    );
    expect(formatM7RecognitionWarning('unknown_internal_code')).toBe(
      '存在其他识别提示，请人工复核',
    );
  });

  it('uses Chinese labels for reference fields', () => {
    expect(formatM7ReferenceField('supplier_code', 'SUP-001')).toBe(
      '供应商编码：SUP-001',
    );
    expect(formatM7ReferenceField('warehouse_name', '原材料仓')).toBe(
      '仓库名称：原材料仓',
    );
  });

  it('merges natural-language supplement tool output and recalculates missing fields', () => {
    const draft = {
      m0_batch_id: 'batch-1',
      tracking_task_id: 'task-1',
      suggested: { delivery_note_number: 'DN-001', warehouse_id: 'WH-01' },
      items: [{ material_code: 'MAT-001', batch_no: 'LOT-1' }],
      missing_fields: [
        'supplier_id',
        'supplier_delivery_number',
        'purchase_order_id',
        'order_id',
        'items[0].purchase_order_item_id',
        'items[0].material_id',
        'items[0].quantity',
        'items[0].uom',
      ],
      warnings: [],
      recognized_document_types: ['purchase_receipt'],
      reference_fields: {},
      source_documents: [],
      requires_human_review: true,
    };

    const merged = applyM7DeliverySupplement(draft, {
      success: true,
      data: {
        status: 'parsed',
        updates: {
          supplier_id: 'SUP-001',
          supplier_delivery_number: 'SUP-DN-001',
          purchase_order_id: 'PO-001',
          order_id: 'SO-001',
          items: [{
            line_number: 1,
            purchase_order_item_id: 'PO-LINE-001',
            material_id: 'MAT-ID-001',
            quantity: '12.5',
            uom: 'kg',
          }],
        },
      },
    });

    expect(merged?.suggested.supplier_id).toBe('SUP-001');
    expect(merged?.items[0]).toMatchObject({
      material_code: 'MAT-001',
      material_id: 'MAT-ID-001',
      quantity: '12.5',
      uom: 'kg',
    });
    expect(merged?.missing_fields).toEqual([]);
    expect(m7DeliveryDraftChatMessage(merged!)).toContain('必填信息已补齐');
    expect(m7DeliveryDraftContext(merged!)).toMatchObject({
      m7_delivery_draft: { m0_batch_id: 'batch-1', tracking_task_id: 'task-1' },
    });
  });

  it('describes unresolved fields in plain Chinese for the conversation', () => {
    const message = m7DeliveryDraftChatMessage({
      m0_batch_id: 'batch-2',
      tracking_task_id: 'task-2',
      suggested: {},
      items: [{}, {}, {}],
      missing_fields: [
        'supplier_id',
        'warehouse_id',
        'items[0].purchase_order_item_id',
        'items[2].batch_no',
        'items[2].quantity',
        'items[2].uom',
      ],
      warnings: [],
      recognized_document_types: [],
      reference_fields: {},
      source_documents: [],
      requires_human_review: true,
    });

    expect(message).toBe([
      '送货单文件已经识别完成。',
      '还需要补充 6 项：',
      '基础信息\n- 供应商内部编号\n- 仓库内部编号',
      '明细信息\n- 第 1 条明细：采购订单行内部编号\n- 第 3 条明细：批次号、数量、单位',
      '请直接用一句话告诉我这些信息，多个字段可以一起说；也可以选择手动补录。',
    ].join('\n\n'));
    expect(message).not.toContain('items[0]');
  });

  it('restores the latest persisted draft marker and honors a later clear marker', () => {
    const draft = {
      m0_batch_id: 'batch-refresh',
      tracking_task_id: 'task-refresh',
      suggested: {},
      items: [{}],
      missing_fields: ['supplier_id'],
      warnings: [],
      recognized_document_types: ['purchase_receipt'],
      reference_fields: {},
      source_documents: [],
      requires_human_review: true,
    };
    const messages = [
      { structuredData: m7DeliveryDraftStructuredData(draft) },
      { structuredData: undefined },
    ];

    expect(latestM7DeliveryDraft(messages)).toEqual(draft);
    expect(latestM7DeliveryDraft([
      ...messages,
      { structuredData: m7DeliveryDraftStructuredData(null) },
    ])).toBeNull();
  });
});
