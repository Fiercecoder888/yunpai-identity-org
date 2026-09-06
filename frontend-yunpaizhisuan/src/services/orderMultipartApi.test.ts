import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../mocks/server';
import { buildBusinessFlowMultipartForm, createBusinessFlowMultipart } from './orderMultipartApi';
import type { BusinessFlowCreateRequest } from './businessFlowRunApi';

const payload: BusinessFlowCreateRequest = {
  idempotency_key: 'business:contract:001',
  order_id: 'ORD-MULTIPART-001',
  order_number: 'SO-MULTIPART-001',
  mode: 'real',
  order_type: 'normal',
  m1_options: { semantic_enrichment: false },
  m2_payload: null,
  m3_payload: null,
  m4_payload: {},
  m4_generate_payload: null,
  m5_payload: null,
  replace_m3_bom_with_m2: true,
  session_id: 'business-multipart',
};

describe('order multipart contract', () => {
  it('builds form fields with idempotency key, JSON payloads and order file', () => {
    const file = new File(['order'], '订单.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const form = buildBusinessFlowMultipartForm(payload, { file, filename: '订单.xlsx' });

    expect(form.get('idempotency_key')).toBe('business:contract:001');
    expect(form.get('order_id')).toBe('ORD-MULTIPART-001');
    expect(form.get('order_number')).toBe('SO-MULTIPART-001');
    expect(form.get('mode')).toBe('real');
    expect(form.get('replace_m3_bom_with_m2')).toBe('true');
    expect(form.get('session_id')).toBe('business-multipart');
    expect(form.get('m4_payload')).toBe('{}');
    expect(form.get('m2_payload')).toBe('null');
    expect(form.get('order_file')).toBeInstanceOf(File);
  });

  it('posts the multipart body and propagates the TaskID header, parsing the created flow', async () => {
    const capturedTaskIds: string[] = [];
    server.use(
      http.post('/api/orchestrator/business-flows', ({ request }) => {
        capturedTaskIds.push(request.headers.get('X-Yunpai-Task-ID') ?? '');
        return HttpResponse.json(
          {
            run_id: 'R-MULTIPART-001',
            tracking_task_id: 'task-multipart-1',
            order_id: 'ORD-MULTIPART-001',
            mode: 'real',
            status: 'queued',
            current_node: 'intake',
          },
          { status: 202 },
        );
      }),
    );

    const file = new File(['order'], '订单.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const created = await createBusinessFlowMultipart(payload, 'task-multipart-1', { file, filename: '订单.xlsx' });

    expect(created).toMatchObject({ run_id: 'R-MULTIPART-001', tracking_task_id: 'task-multipart-1', status: 'queued' });
    expect(capturedTaskIds).toEqual(['task-multipart-1']);
  });
});
