import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import {
  bindM0Document,
  deleteM0DocumentBinding,
  getM0DocumentFile,
  listM0DocumentBindings,
  listM0Documents,
  updateM0DocumentDocType,
} from './m0DocumentsApi';

const masterDocument = {
  id: 1,
  batch_id: 'M0-BATCH-001',
  domain: 'drawing',
  doc_type: 'engineering_drawing',
  doc_no: '',
  title: '图纸_承认书_ABC-123.pdf',
  content_text: '',
  stored_name: 'mock-drawing.pdf',
  status: 'approved',
  created_at: '2026-08-10T00:00:00Z',
};

const binding = {
  id: 11,
  doc_id: 1,
  entity_type: 'material' as const,
  entity_id: 'CABLE-2M',
  entity_code: 'CABLE-2M',
  entity_name: 'HDMI 线材 2M',
  stage: '押出',
  created_by: 'mock',
  created_at: '2026-08-10T00:00:00Z',
};

const envelope = (data: unknown) => ({ success: true, data, errors: [] });

describe('m0DocumentsApi 文档绑定与预览', () => {
  it('按实体查询文档（material/product/order）', async () => {
    server.use(
      http.get('/api/m0/documents', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('material')).toBe('CABLE-2M');
        return HttpResponse.json(envelope({ documents: [{ ...masterDocument, bindings: [binding] }] }));
      }),
    );
    const result = await listM0Documents({ material: 'CABLE-2M' });
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]!.doc_type).toBe('engineering_drawing');
    expect(result.documents[0]!.bindings[0]!.entity_code).toBe('CABLE-2M');
  });

  it('绑定文档并返回绑定记录', async () => {
    let posted: unknown;
    server.use(
      http.post('/api/m0/documents/1/bindings', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(envelope({ bindings: [{ ...binding, id: 12 }] }));
      }),
    );
    const result = await bindM0Document(1, [
      { entity_type: 'material', entity_id: 'CABLE-2M', entity_name: 'HDMI 线材 2M', stage: '押出' },
    ]);
    expect(posted).toEqual({
      bindings: [{ entity_type: 'material', entity_id: 'CABLE-2M', entity_name: 'HDMI 线材 2M', stage: '押出' }],
    });
    expect(result.bindings[0]!.id).toBe(12);
  });

  it('查询某文档全部绑定', async () => {
    server.use(
      http.get('/api/m0/documents/1/bindings', () =>
        HttpResponse.json(envelope({ document: masterDocument, bindings: [binding] })),
      ),
    );
    const result = await listM0DocumentBindings(1);
    expect(result.bindings).toHaveLength(1);
    expect(result.document.id).toBe(1);
  });

  it('解绑绑定', async () => {
    let deleted = '';
    server.use(
      http.delete('/api/m0/documents/bindings/7', ({ request }) => {
        deleted = request.method;
        return HttpResponse.json(envelope({ deleted: 7 }));
      }),
    );
    const result = await deleteM0DocumentBinding(7);
    expect(deleted).toBe('DELETE');
    expect(result.deleted).toBe(7);
  });

  it('人工修正文档类型', async () => {
    let posted: unknown;
    server.use(
      http.post('/api/m0/documents/1/doc_type', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(envelope({ document: { ...masterDocument, doc_type: 'test_method' } }));
      }),
    );
    const result = await updateM0DocumentDocType(1, 'test_method');
    expect(posted).toEqual({ doc_type: 'test_method' });
    expect(result.document.doc_type).toBe('test_method');
  });

  it('文件流下载返回 Blob', async () => {
    server.use(
      http.get('/api/m0/documents/1/file', () =>
        HttpResponse.arrayBuffer(new TextEncoder().encode('%PDF-1.4').buffer, {
          headers: { 'Content-Type': 'application/pdf' },
        }),
      ),
    );
    const blob = await getM0DocumentFile(1);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
  });
});
