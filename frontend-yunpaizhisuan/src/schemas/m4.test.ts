import { describe, expect, it } from 'vitest';
import {
  m4AlertPageSchema,
  m4AlertStatusSchema,
  m4ErrorResponseSchema,
  m4ImportBatchSchema,
  m4PurchaseOrderSchema,
  m4ReplyParseResultSchema,
  m4TrackingSchema,
} from './m4';

describe('m4 schemas', () => {
  it('parses paginated alert payloads', () => {
    const payload = m4AlertPageSchema.parse({
      items: [
        {
          id: 501,
          alert_type: 'overdue',
          purchase_order_no: 'PO-1',
          supplier_name: '华东五金供应商',
          item_code: 'MAT-001',
          item_name: '轴承',
          promised_date: '2026-07-01',
          days_overdue: 4,
          urge_message: null,
          status: 'open',
        },
      ],
      page: 1,
      page_size: 20,
      total: 1,
    });

    expect(payload.total).toBe(1);
    expect(payload.items[0]?.status).toBe('open');
  });

  it('accepts the M4 error response shape', () => {
    expect(
      m4ErrorResponseSchema.parse({
        code: 'VALIDATION_ERROR',
        message: '字段校验失败',
        details: [{ field: 'quantity', message: 'must be greater than 0' }],
      }),
    ).toEqual({
      code: 'VALIDATION_ERROR',
      message: '字段校验失败',
      details: [{ field: 'quantity', message: 'must be greater than 0' }],
    });
  });

  it('validates status enums', () => {
    expect(m4AlertStatusSchema.parse('processing')).toBe('processing');
    expect(() => m4AlertStatusSchema.parse('archived')).toThrow();
  });

  it('normalizes decimal fields to strings', () => {
    const order = m4PurchaseOrderSchema.parse({
      id: 201,
      purchase_order_no: 'PO-1',
      supplier_name: '华东五金供应商',
      status: 'pending_send',
      required_date: '2026-07-15',
      items: [{ id: 301, item_code: 'MAT-001', item_name: '轴承', quantity: 100, unit: 'pcs', status: 'pending' }],
    });
    const tracking = m4TrackingSchema.parse({
      id: 401,
      purchase_order_item_id: 301,
      promised_date: '2026-07-18',
      unit_price: 12.5,
      currency: 'CNY',
      exception_type: null,
      exception_description: null,
      arrival_status: 'not_received',
      is_overdue: false,
    });

    expect(order.items[0]?.quantity).toBe('100');
    expect(tracking.unit_price).toBe('12.5');
  });

  it('preserves scoped import and purchase-order audit identity', () => {
    const batch = m4ImportBatchSchema.parse({
      id: 11,
      filename: 'json_import.json',
      total_rows: 0,
      valid_rows: 0,
      invalid_rows: 0,
      duplicate_rows: 0,
      status: 'completed',
      items: [],
      tenant_id: 'TENANT-1',
      site_id: 'SITE-1',
      tracking_task_id: 'TASK-1',
      source_plan_id: 'PLAN-1',
      source_plan_version: 'PLAN-1-v2',
      source_plan_checksum: 'sha256:plan-v2',
      payload_digest: 'sha256:command-v2',
    });
    const order = m4PurchaseOrderSchema.parse({
      id: 12,
      purchase_order_no: 'PO-12',
      tenant_id: 'TENANT-1',
      site_id: 'SITE-1',
      source_import_batch_id: 11,
      tracking_task_id: 'TASK-1',
      supplier_name: '供应商',
      status: 'draft',
      items: [],
    });

    expect(batch.tracking_task_id).toBe('TASK-1');
    expect(batch.source_plan_checksum).toBe('sha256:plan-v2');
    expect(order).toMatchObject({
      tenant_id: 'TENANT-1',
      site_id: 'SITE-1',
      source_import_batch_id: 11,
      tracking_task_id: 'TASK-1',
    });
  });

  it('parses low-confidence AI reply results that need human confirmation', () => {
    const result = m4ReplyParseResultSchema.parse({
      delivery_date: '2026-07-25',
      unit_price: '12.50',
      currency: 'CNY',
      tax_included: true,
      exception_type: 'delivery_delay',
      exception_description: '供应商库存不足，交期延后',
      confidence: 0.62,
      need_human_review: true,
    });

    expect(result.need_human_review).toBe(true);
    expect(result.unit_price).toBe('12.50');
  });
});
