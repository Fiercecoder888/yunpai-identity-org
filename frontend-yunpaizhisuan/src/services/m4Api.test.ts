import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import {
  approveM4PurchaseOrder,
  confirmM4ReplyParse,
  createM4Supplier,
  createM4SupplierReply,
  exportM4AlertsCsv,
  exportM4TrackingCsv,
  generateM4AlertUrgeMessage,
  generateM4PurchaseInquiryMessage,
  generateM4PurchaseOrders,
  getM4ImportBatch,
  getM4PurchaseOrder,
  importM4SuggestionsJson,
  listM4Alerts,
  listM4PurchaseOrders,
  listM4Suggestions,
  listM4Suppliers,
  listM4Tracking,
  parseM4SupplierReply,
  rejectM4PurchaseOrder,
  scanM4Alerts,
  sendM4PurchaseOrder,
  submitM4PurchaseOrderReview,
  updateM4AlertStatus,
  updateM4PurchaseOrder,
  updateM4Supplier,
  uploadM4ImportBatch,
} from './m4Api';

describe('m4Api', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads purchase suggestion CSV with FormData and no manual multipart header', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 1,
          filename: 'purchase.csv',
          total_rows: 1,
          valid_rows: 1,
          invalid_rows: 0,
          duplicate_rows: 0,
          status: 'completed',
          created_at: '2026-07-03T10:30:00',
          items: [],
        }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    const response = await uploadM4ImportBatch(new File(['item_code,item_name'], 'purchase.csv', { type: 'text/csv' }));
    const init = fetchSpy.mock.calls[0]?.[1];

    expect(response.filename).toBe('purchase.csv');
    expect(init?.body).toBeInstanceOf(FormData);
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false);
  });

  it('exports alert CSV as text instead of parsing JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('id,alert_type\n501,overdue', {
        status: 200,
        headers: { 'Content-Type': 'text/csv; charset=utf-8' },
      }),
    );

    await expect(exportM4AlertsCsv()).resolves.toContain('501,overdue');
  });

  it('imports purchase suggestions from JSON through the gateway route', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 1,
          filename: 'json_import.csv',
          total_rows: 1,
          valid_rows: 1,
          invalid_rows: 0,
          duplicate_rows: 0,
          status: 'success',
          items: [{
            id: 101,
            batch_id: 1,
            row_number: 1,
            item_code: 'MAT-001',
            item_name: '铝板',
            quantity: '2',
            unit: '件',
            supplier_name: '华东供应商',
            required_date: '2026-07-30',
            project_code: 'P-001',
            validation_status: 'valid',
            error_message: '',
          }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(importM4SuggestionsJson({ items: [] })).resolves.toHaveLength(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/m4/suggestions/import-json');
    expect(fetchSpy.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ suggestions: [] }));
  });

  it('preserves M3 source identity in the JSON import command', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 1,
          filename: 'json_import.csv',
          total_rows: 0,
          valid_rows: 0,
          invalid_rows: 0,
          duplicate_rows: 0,
          status: 'success',
          items: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const command = {
      suggestions: [],
      tenant_id: 'TENANT-1',
      site_id: 'SITE-1',
      tracking_task_id: 'TASK-1',
      idempotency_key: 'IDEM-1',
      procurement_plan_id: 'PLAN-1',
      procurement_plan_version_id: 'v2',
      source_plan_checksum: 'sha256:plan-v2',
    };

    await importM4SuggestionsJson(command);

    expect(fetchSpy.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(command));
  });

  it('propagates the source TaskID when generating purchase orders', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 201,
            purchase_order_no: 'PO-TRACKED-1',
            tenant_id: 'TENANT-1',
            site_id: 'SITE-1',
            source_import_batch_id: 11,
            tracking_task_id: 'TASK-1',
            supplier_name: '供应商',
            status: 'draft',
            items: [],
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const orders = await generateM4PurchaseOrders([101], '  TASK-1  ');
    const requestHeaders = new Headers(fetchSpy.mock.calls[0]?.[1]?.headers);

    expect(requestHeaders.get('X-Yunpai-Task-ID')).toBe('TASK-1');
    expect(orders[0]).toMatchObject({
      source_import_batch_id: 11,
      tracking_task_id: 'TASK-1',
    });
  });

  it('parses low-confidence supplier replies and confirms corrected results', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            delivery_date: '2026-07-25',
            unit_price: '12.50',
            currency: 'CNY',
            tax_included: true,
            exception_type: 'delivery_delay',
            exception_description: '供应商库存不足，交期延后',
            confidence: 0.62,
            need_human_review: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            delivery_date: '2026-07-26',
            unit_price: '12.80',
            currency: 'CNY',
            tax_included: true,
            exception_type: 'delivery_delay',
            exception_description: '人工确认交期延后',
            confidence: 1,
            need_human_review: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    const parsed = await parseM4SupplierReply(601);
    const confirmed = await confirmM4ReplyParse(601, {
      ...parsed,
      delivery_date: '2026-07-26',
      unit_price: '12.80',
      confidence: 1,
      need_human_review: false,
      confirmed_by: '采购员',
    });

    expect(parsed.need_human_review).toBe(true);
    expect(confirmed.need_human_review).toBe(false);
    expect(fetchSpy.mock.calls[1]?.[0]).toContain('/api/m4/replies/601/confirm');
  });

  it('validates the M4 service API surface through MSW handlers', async () => {
    const suppliers = await listM4Suppliers({ page: 1, pageSize: 2 });
    expect(suppliers.items.length).toBeGreaterThan(0);

    const createdSupplier = await createM4Supplier({
      supplier_name: '华东测试供应商',
      contact_name: '测试联系人',
      email: 'buyer@example.test',
      default_channel: 'email',
      status: 'active',
    });
    const updatedSupplier = await updateM4Supplier(createdSupplier.id, { remark: 'service integration checked' });
    expect(updatedSupplier.remark).toBe('service integration checked');

    const batch = await getM4ImportBatch(1);
    expect(batch.items.length).toBeGreaterThan(0);

    const suggestions = await listM4Suggestions({ page: 1, pageSize: 1, validationStatus: 'valid' });
    const suggestionId = suggestions.items[0]?.id ?? 1;
    const generatedOrders = await generateM4PurchaseOrders([suggestionId]);
    expect(generatedOrders.length).toBeGreaterThan(0);

    const orderPage = await listM4PurchaseOrders({ page: 1, pageSize: 1, status: 'all' });
    const orderId = orderPage.items[0]?.id ?? generatedOrders[0]?.id ?? 1;
    const order = await getM4PurchaseOrder(orderId);
    const updatedOrder = await updateM4PurchaseOrder(orderId, {
      supplier_name: order.supplier_name,
      required_date: '2026-08-01',
      items: [],
    });
    expect(updatedOrder.required_date).toBe('2026-08-01');

    await expect(submitM4PurchaseOrderReview(orderId, { comment: 'submit for review' })).resolves.toMatchObject({ status: 'pending_review' });
    await expect(approveM4PurchaseOrder(orderId, { operated_by: 'tester' })).resolves.toMatchObject({ status: 'pending_send' });
    await expect(rejectM4PurchaseOrder(orderId, { comment: 'negative path checked' })).resolves.toMatchObject({ status: 'rejected' });

    const inquiry = await generateM4PurchaseInquiryMessage(orderId, { channel: 'email' });
    expect(inquiry.content).toContain(order.purchase_order_no);
    await expect(sendM4PurchaseOrder(orderId)).resolves.toMatchObject({ status: 'sent' });

    const reply = await createM4SupplierReply({
      purchase_order_id: orderId,
      purchase_order_no: order.purchase_order_no,
      supplier_name: order.supplier_name,
      reply_content: '报价 12.50，7月25日可交付。',
      received_at: '2026-07-06T10:00:00',
    });
    const parsed = await parseM4SupplierReply(reply.id);
    expect(parsed.need_human_review).toBe(false);
    await expect(confirmM4ReplyParse(reply.id, { ...parsed, confirmed_by: 'tester' })).resolves.toMatchObject({ need_human_review: false });

    const tracking = await listM4Tracking({ page: 1, pageSize: 2 });
    expect(tracking.items.length).toBeGreaterThan(0);
    await expect(exportM4TrackingCsv()).resolves.toContain('purchase_order_item_id');

    await expect(scanM4Alerts()).resolves.toMatchObject({ scanned: expect.any(Number), created: expect.any(Number) });
    const alerts = await listM4Alerts({ page: 1, pageSize: 2, status: 'all', alertType: 'all' });
    const alertId = alerts.items[0]?.id ?? 1;
    await expect(generateM4AlertUrgeMessage(alertId, { channel: 'wechat' })).resolves.toMatchObject({ alert_id: alertId });
    await expect(updateM4AlertStatus(alertId, 'processing')).resolves.toMatchObject({ status: 'processing' });
    await expect(exportM4AlertsCsv()).resolves.toContain('alert_type');
  });

  it('normalizes structured and plain M4 error responses', async () => {
    server.use(
      http.get('/api/m4/alerts', () =>
        HttpResponse.json({ code: 'validation_error', message: '筛选参数错误', details: [{ field: 'status' }] }, { status: 400 }),
      ),
      http.get('/api/m4/suppliers', () => HttpResponse.json({ message: '供应商服务异常' }, { status: 500 })),
    );

    await expect(listM4Alerts()).rejects.toMatchObject({
      error: {
        code: 'validation_error',
        status: 400,
        message: '筛选参数错误',
        detail: { code: 'validation_error', message: '筛选参数错误', details: [{ field: 'status' }] },
      },
    });
    await expect(listM4Suppliers()).rejects.toMatchObject({
      error: { code: 'server_error', status: 500, detail: { message: '供应商服务异常' } },
    });
  });
});
