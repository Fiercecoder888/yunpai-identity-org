import { z } from 'zod';

export const m2HealthSchema = z.object({ status: z.string() }).passthrough();
export const m2WorkflowResultSchema = z.object({ result: z.unknown().optional() }).passthrough();
export const m2BomHistoryResultSchema = z.object({ items: z.array(z.unknown()).default([]) }).passthrough();
export const m2ControlledBomSchema = z.object({ bom_id: z.string().optional() }).passthrough();
export const m2TemplateOnboardResultSchema = z.object({ template_id: z.string().optional() }).passthrough();
export const m2SopResultSchema = z.object({ sop_id: z.string().optional() }).passthrough();

const m2BomHeaderSchema = z
  .object({
    bom_id: z.string().default(''),
    bom_type: z.string().default(''),
    parent_item: z.string().default(''),
    parent_revision: z.string().default(''),
    parent_name: z.string().default(''),
    base_qty: z.union([z.number(), z.string()]).optional(),
    uom: z.string().default(''),
    status: z.string().default(''),
    effective_from: z.string().default(''),
    source_basis: z.string().default(''),
    confidence: z.string().default(''),
  })
  .passthrough();

export const m2BomLineSchema = z
  .object({
    bom_id: z.string().default(''),
    line_no: z.union([z.number(), z.string()]),
    component_item: z.string().default(''),
    component_revision: z.string().default(''),
    component_name: z.string().default(''),
    qty_per: z.union([z.number(), z.string()]),
    uom: z.string().default(''),
    scrap_pct: z.union([z.number(), z.string()]).optional(),
    item_category: z.string().default(''),
    supply_type: z.string().default(''),
    notes: z.string().default(''),
  })
  .passthrough();

const m2SopFlowStepSchema = z
  .object({
    id: z.string().default(''),
    name: z.string().default(''),
    model_shape: z.string().default(''),
    rendered_shape: z.string().default(''),
    changed: z.boolean().default(false),
  })
  .passthrough();

const m2SopGenerationSchema = z
  .object({
    status: z.string().default(''),
    run_id: z.string().default(''),
    product_name: z.string().default(''),
    part_no: z.string().default(''),
    document_no: z.string().default(''),
    station: z.string().default(''),
    generation_sequence: z.array(z.string()).default([]),
    model: z
      .object({
        content_source: z.string().optional(),
        normalization: z
          .object({
            shape_normalization: z.array(m2SopFlowStepSchema).default([]),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .default({}),
    validation: z.record(z.unknown()).default({}),
    artifacts: z.record(z.string().nullable()).default({}),
    warnings: z.array(z.string()).default([]),
    ai_boundary: z.string().default(''),
  })
  .passthrough();

const m2CustomerQuestionSchema = z
  .object({
    question_id: z.string().optional(),
    question: z.string().default(''),
    field: z.string().default(''),
    blocking: z.boolean().optional(),
    reason: z.string().default(''),
    source: z.string().default(''),
  })
  .passthrough();

export const m2ProductWorkflowSchema = z
  .object({
    workflow_id: z.string().optional(),
    status: z.string(),
    run_id: z.string(),
    bom_generation: z
      .object({
        standard_bom: z
          .object({
            bom_header: z.array(m2BomHeaderSchema).default([]),
            bom_lines: z.array(m2BomLineSchema).default([]),
            item_master: z.array(z.record(z.unknown())).default([]),
            assumptions: z.array(z.record(z.unknown())).default([]),
          })
          .passthrough(),
        generation_decision: z.record(z.unknown()).optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    sop_generation: m2SopGenerationSchema.nullable().optional(),
    open_customer_questions: z.array(m2CustomerQuestionSchema).default([]),
    artifacts: z.record(z.string()).default({}),
    completeness_check: z.record(z.unknown()).default({}),
  })
  .passthrough();

const m2ParsedSopStepSchema = z
  .object({
    slot_no: z.union([z.number(), z.string()]),
    title: z.string().default(''),
    description: z.string().default(''),
    visual_type: z.string().default(''),
  })
  .passthrough();

const m2ParsedSopTimeRowSchema = z
  .object({
    action: z.string().default(''),
    machine_model: z.string().default(''),
    standard_time_s: z.union([z.number(), z.string()]).optional(),
    time_source: z.string().default(''),
  })
  .passthrough();

export const m2ParsedSopSchema = z
  .object({
    status: z.string().default(''),
    metadata: z
      .object({
        product_name: z.string().default(''),
        part_no: z.string().default(''),
        document_no: z.string().default(''),
        station: z.string().default(''),
        version: z.string().default(''),
      })
      .passthrough()
      .default({}),
    operation_order: z.string().default(''),
    step_slots: z.array(m2ParsedSopStepSchema).default([]),
    ie_time_study_rows: z.array(m2ParsedSopTimeRowSchema).default([]),
    notes: z.array(z.string()).default([]),
  })
  .passthrough();

export type M2ProductWorkflow = z.infer<typeof m2ProductWorkflowSchema>;
export type M2BomLine = z.infer<typeof m2BomLineSchema>;
export type M2ParsedSop = z.infer<typeof m2ParsedSopSchema>;
