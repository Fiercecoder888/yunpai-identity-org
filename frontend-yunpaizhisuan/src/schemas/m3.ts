import { z } from 'zod';

export const m3OrderSchema = z.object({
  order_id: z.string().optional(),
  id: z.string().optional(),
}).passthrough();

export const m3ProcurementPlanSchema = z.object({
  plan_id: z.string().optional(),
  id: z.string().optional(),
}).passthrough();

export const m3ApprovalTaskSchema = z.object({
  approval_id: z.string().optional(),
  task_id: z.string().optional(),
  id: z.string().optional(),
  target_type: z.string().optional(),
  status: z.string().optional(),
}).passthrough();

export const m3MaterialReadinessLineStatusSchema = z.enum([
  'ready',
  'allocated_by_fifo',
  'covered_by_stock_or_open_po',
  'shortage',
  'blocked',
]);

export const m3MaterialReadinessLineSchema = z.object({
  material_code: z.string(),
  material_name: z.string(),
  uom: z.string(),
  gross_required_qty: z.number(),
  available_qty: z.number(),
  open_po_qty: z.number(),
  shortage_qty: z.number(),
  suggest_purchase_qty: z.number(),
  line_status: m3MaterialReadinessLineStatusSchema,
  expected_available_date: z.string().nullable().optional(),
  fifo_allocation_count: z.number().int().optional(),
  urgent: z.boolean().optional(),
}).passthrough();

export const m3MaterialReadinessSchema = z.object({
  material_ready_status: z.enum([
    'blocked_by_data_quality',
    'blocked_by_unresolved_shortage',
    'shortage_with_procurement_plan',
    'ready',
  ]).optional(),
  pmc_release_recommendation: z.enum([
    'do_not_release_formal_schedule',
    'allow_draft_schedule_only',
    'ready_for_formal_schedule',
  ]).optional(),
  lines: z.array(m3MaterialReadinessLineSchema).optional(),
  items: z.array(m3MaterialReadinessLineSchema).optional(),
}).passthrough().transform((value) => {
  const lines = value.lines ?? value.items ?? [];
  return { ...value, lines, items: value.items ?? lines };
});

const m3PrPoLineSchema = z.object({
  material_code: z.string(),
  material_name: z.string(),
  purchase_qty: z.number(),
  uom: z.string(),
  supplier_id: z.string().nullable().optional(),
  supplier_name: z.string().nullable().optional(),
}).passthrough();

const m3PurchaseOrderDraftSchema = z.object({
  draft_id: z.string(),
  supplier_id: z.string().nullable(),
  supplier_name: z.string().nullable(),
  status: z.string(),
  lines: z.array(m3PrPoLineSchema),
}).passthrough();

export const m3PrPoDraftSchema = z.object({
  status: z.enum(['blocked_by_procurement_approval', 'draft_ready_for_external_system']).optional(),
  release_gate: z.literal('procurement_plan_approval').optional(),
  purchase_requisition_draft: z.object({
    draft_id: z.string(),
    status: z.string(),
    lines: z.array(m3PrPoLineSchema),
  }).passthrough().optional(),
  purchase_order_drafts: z.array(m3PurchaseOrderDraftSchema).optional(),
  items: z.array(m3PurchaseOrderDraftSchema).optional(),
}).passthrough().transform((value) => {
  const purchaseOrderDrafts = value.purchase_order_drafts ?? value.items ?? [];
  return {
    ...value,
    purchase_order_drafts: purchaseOrderDrafts,
    items: value.items ?? purchaseOrderDrafts,
  };
});

export type M3Order = z.infer<typeof m3OrderSchema>;
export type M3ProcurementPlan = z.infer<typeof m3ProcurementPlanSchema>;
export type M3ApprovalTask = z.infer<typeof m3ApprovalTaskSchema>;
export type M3MaterialReadiness = z.infer<typeof m3MaterialReadinessSchema>;
export type M3MaterialReadinessLine = z.infer<typeof m3MaterialReadinessLineSchema>;
export type M3PrPoDrafts = z.infer<typeof m3PrPoDraftSchema>;
