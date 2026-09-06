import { describe, expect, it } from 'vitest';
import {
  m3MaterialReadinessLineStatusSchema,
  m3MaterialReadinessSchema,
  m3PrPoDraftSchema,
} from './m3';

const readinessLine = {
  material_code: 'MAT-001',
  material_name: 'Material 001',
  uom: 'PCS',
  gross_required_qty: 10,
  available_qty: 10,
  open_po_qty: 0,
  shortage_qty: 0,
  suggest_purchase_qty: 0,
  line_status: 'covered_by_stock_or_open_po' as const,
};

describe('m3 schemas', () => {
  it('parses the standard material readiness lines and exposes the legacy items alias', () => {
    const payload = m3MaterialReadinessSchema.parse({
      material_ready_status: 'ready',
      pmc_release_recommendation: 'ready_for_formal_schedule',
      lines: [readinessLine],
    });

    expect(payload.lines[0]?.line_status).toBe('covered_by_stock_or_open_po');
    expect(payload.items).toEqual(payload.lines);
  });

  it('accepts the legacy items shape and exposes canonical lines', () => {
    const payload = m3MaterialReadinessSchema.parse({ items: [readinessLine] });

    expect(payload.lines).toEqual(payload.items);
  });

  it('validates readiness status values', () => {
    expect(m3MaterialReadinessLineStatusSchema.parse('allocated_by_fifo')).toBe('allocated_by_fifo');
    expect(() => m3MaterialReadinessLineStatusSchema.parse('covered')).toThrow();
  });

  it('parses standard PR/PO drafts and exposes the legacy items alias', () => {
    const payload = m3PrPoDraftSchema.parse({
      status: 'blocked_by_procurement_approval',
      release_gate: 'procurement_plan_approval',
      purchase_requisition_draft: {
        draft_id: 'PR-DRAFT-001',
        status: 'blocked_by_procurement_approval',
        lines: [],
      },
      purchase_order_drafts: [{
        draft_id: 'PO-DRAFT-001',
        supplier_id: 'SUP-001',
        supplier_name: 'Supplier 001',
        status: 'blocked_by_procurement_approval',
        lines: [],
      }],
    });

    expect(payload.items).toEqual(payload.purchase_order_drafts);
  });
});
