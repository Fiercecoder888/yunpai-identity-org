import { z } from 'zod';

export const m4DecimalSchema = z.union([z.string(), z.number()]).transform((value) => String(value));

export const m4PageSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    page: z.number(),
    page_size: z.number(),
    total: z.number(),
  });

export const m4ErrorResponseSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.array(z.record(z.unknown())).default([]),
});

export const m4PurchaseOrderStatusSchema = z.enum([
  'draft',
  'pending_review',
  'rejected',
  'pending_send',
  'sent',
  'replied',
  'parse_pending_review',
  'tracking',
  'alerted',
  'completed',
  'cancelled',
]);

export const m4PurchaseOrderItemStatusSchema = z.enum([
  'pending',
  'sent',
  'replied',
  'confirmed',
  'partial_received',
  'received',
  'overdue',
  'closed_exception',
]);

export const m4AlertTypeSchema = z.enum(['overdue', 'due_soon', 'supplier_exception']);
export const m4AlertStatusSchema = z.enum(['open', 'processing', 'closed']);
export const m4SendChannelSchema = z.enum(['email', 'dingtalk', 'feishu', 'wechat', 'enterprise_wechat', 'sms', 'manual']);
export const m4ValidationStatusSchema = z.enum(['valid', 'invalid', 'duplicate']);
export const m4ArrivalStatusSchema = z.enum(['not_received', 'partial_received', 'received', 'overdue', 'closed_exception']);

export const m4SupplierSchema = z.object({
  id: z.number(),
  supplier_name: z.string(),
  contact_name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  default_channel: m4SendChannelSchema.or(z.string()).default('email'),
  remark: z.string().nullable().optional(),
  status: z.string(),
});

export const m4SupplierCreateSchema = z.object({
  supplier_name: z.string().min(1),
  contact_name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  default_channel: m4SendChannelSchema.default('email'),
  remark: z.string().nullable().optional(),
  status: z.string().default('active'),
});

export const m4SupplierUpdateSchema = m4SupplierCreateSchema.partial();

export const m4SuggestionItemSchema = z.object({
  id: z.number().nullable().optional(),
  batch_id: z.number().nullable().optional(),
  row_number: z.number(),
  item_code: z.string().nullable(),
  item_name: z.string().nullable(),
  quantity: m4DecimalSchema.nullable(),
  unit: z.string().nullable(),
  supplier_name: z.string().nullable(),
  required_date: z.string().nullable(),
  project_code: z.string().nullable(),
  remark: z.string().nullable().optional(),
  validation_status: m4ValidationStatusSchema,
  error_message: z.string().default(''),
});

export const m4ImportBatchSchema = z.object({
  id: z.number().nullable().optional(),
  filename: z.string(),
  total_rows: z.number(),
  valid_rows: z.number(),
  invalid_rows: z.number(),
  duplicate_rows: z.number(),
  status: z.string(),
  created_at: z.string().nullable().optional(),
  items: z.array(m4SuggestionItemSchema).default([]),
  tenant_id: z.string().nullable().optional(),
  site_id: z.string().nullable().optional(),
  tracking_task_id: z.string().nullable().optional(),
  idempotency_key: z.string().nullable().optional(),
  source_module: z.string().nullable().optional(),
  source_plan_id: z.string().nullable().optional(),
  source_plan_version: z.string().nullable().optional(),
  source_plan_checksum: z.string().nullable().optional(),
  source_order_id: z.string().nullable().optional(),
  source_order_version: z.string().nullable().optional(),
  project_id: z.string().nullable().optional(),
  bom_id: z.string().nullable().optional(),
  source_event_id: z.string().nullable().optional(),
  observed_at: z.string().nullable().optional(),
  actor: z.string().nullable().optional(),
  data_scope: z.string().nullable().optional(),
  payload_digest: z.string().nullable().optional(),
});

export const m4GeneratePurchaseOrdersRequestSchema = z.object({
  suggestion_item_ids: z.array(z.number()).min(1),
});

export const m4PurchaseOrderItemSchema = z.object({
  id: z.number(),
  item_code: z.string(),
  item_name: z.string(),
  quantity: m4DecimalSchema,
  unit: z.string(),
  status: m4PurchaseOrderItemStatusSchema,
});

export const m4PurchaseOrderSchema = z.object({
  id: z.number(),
  purchase_order_no: z.string(),
  tenant_id: z.string().nullable().optional(),
  site_id: z.string().nullable().optional(),
  source_import_batch_id: z.number().nullable().optional(),
  tracking_task_id: z.string().nullable().optional(),
  supplier_name: z.string(),
  status: m4PurchaseOrderStatusSchema,
  required_date: z.string().nullable().optional(),
  items: z.array(m4PurchaseOrderItemSchema).default([]),
});

export const m4PurchaseOrderItemUpdateSchema = z.object({
  id: z.number(),
  item_name: z.string().nullable().optional(),
  quantity: m4DecimalSchema.nullable().optional(),
  unit: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
});

export const m4PurchaseOrderUpdateSchema = z.object({
  supplier_name: z.string().nullable().optional(),
  required_date: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
  items: z.array(m4PurchaseOrderItemUpdateSchema).default([]),
});

export const m4ReviewRequestSchema = z.object({
  comment: z.string().nullable().optional(),
  operated_by: z.string().nullable().optional(),
});

export const m4PurchaseInquiryMessageRequestSchema = z.object({
  channel: m4SendChannelSchema.default('email'),
  language: z.string().max(32).nullable().optional(),
});

export const m4PurchaseInquiryMessageSchema = z.object({
  message_id: z.number(),
  subject: z.string().nullable().optional(),
  content: z.string(),
  channel: z.string(),
  recipient: z.string().nullable().optional(),
  send_status: z.string(),
  model_name: z.string().nullable().optional(),
  prompt_version: z.string().nullable().optional(),
});

export const m4SupplierReplyCreateSchema = z.object({
  purchase_order_id: z.number(),
  purchase_order_no: z.string(),
  supplier_name: z.string(),
  reply_content: z.string().min(1),
  received_at: z.string().nullable().optional(),
});

export const m4SupplierReplySchema = m4SupplierReplyCreateSchema.extend({
  id: z.number(),
});

export const m4ReplyParseResultSchema = z.object({
  delivery_date: z.string().nullable().optional(),
  unit_price: m4DecimalSchema.nullable().optional(),
  currency: z.string().default('CNY'),
  tax_included: z.boolean().nullable().optional(),
  exception_type: z.string().nullable().optional(),
  exception_description: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
  need_human_review: z.boolean(),
});

export const m4ConfirmParseResultRequestSchema = m4ReplyParseResultSchema.extend({
  confirmed_by: z.string().nullable().optional(),
});

export const m4TrackingSchema = z.object({
  id: z.number(),
  purchase_order_item_id: z.number(),
  promised_date: z.string().nullable().optional(),
  unit_price: m4DecimalSchema.nullable().optional(),
  currency: z.string().nullable().optional(),
  exception_type: z.string().nullable().optional(),
  exception_description: z.string().nullable().optional(),
  arrival_status: m4ArrivalStatusSchema,
  is_overdue: z.boolean(),
});

export const m4AlertSchema = z.object({
  id: z.number(),
  alert_type: m4AlertTypeSchema,
  purchase_order_no: z.string(),
  supplier_name: z.string(),
  item_code: z.string(),
  item_name: z.string(),
  promised_date: z.string(),
  days_overdue: z.number(),
  urge_message: z.string().nullable().optional(),
  status: m4AlertStatusSchema,
});

export const m4AlertScanResultSchema = z.object({
  scanned: z.number(),
  created: z.number(),
});

export const m4UrgeMessageRequestSchema = z.object({
  channel: m4SendChannelSchema.default('wechat'),
  language: z.string().max(32).nullable().optional(),
});

export const m4UrgeMessageSchema = z.object({
  alert_id: z.number(),
  urge_message: z.string(),
  channel: z.string(),
  model_name: z.string().nullable().optional(),
  prompt_version: z.string().nullable().optional(),
});

export const m4AlertStatusUpdateSchema = z.object({
  status: m4AlertStatusSchema,
});

export const m4SupplierPageSchema = m4PageSchema(m4SupplierSchema);
export const m4SuggestionPageSchema = m4PageSchema(m4SuggestionItemSchema);
export const m4PurchaseOrderPageSchema = m4PageSchema(m4PurchaseOrderSchema);
export const m4TrackingPageSchema = m4PageSchema(m4TrackingSchema);
export const m4AlertPageSchema = m4PageSchema(m4AlertSchema);

export type M4Page<T> = {
  items: T[];
  page: number;
  page_size: number;
  total: number;
};
export type M4Supplier = z.infer<typeof m4SupplierSchema>;
export type M4SuggestionItem = z.infer<typeof m4SuggestionItemSchema>;
export type M4ImportBatch = z.infer<typeof m4ImportBatchSchema>;
export type M4PurchaseOrder = z.infer<typeof m4PurchaseOrderSchema>;
export type M4PurchaseOrderItem = z.infer<typeof m4PurchaseOrderItemSchema>;
export type M4PurchaseInquiryMessage = z.infer<typeof m4PurchaseInquiryMessageSchema>;
export type M4SupplierReply = z.infer<typeof m4SupplierReplySchema>;
export type M4ReplyParseResult = z.infer<typeof m4ReplyParseResultSchema>;
export type M4Tracking = z.infer<typeof m4TrackingSchema>;
export type M4Alert = z.infer<typeof m4AlertSchema>;
export type M4UrgeMessage = z.infer<typeof m4UrgeMessageSchema>;
export type M4AlertStatus = z.infer<typeof m4AlertStatusSchema>;
export type M4AlertType = z.infer<typeof m4AlertTypeSchema>;
export type M4PurchaseOrderStatus = z.infer<typeof m4PurchaseOrderStatusSchema>;
