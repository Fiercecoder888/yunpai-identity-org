import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../mocks/server';
import { authRuntime } from '../auth/authRuntime';
import { listM0Batches, m0BatchFileCount, uploadM0Files, waitForM0Batch } from './m0Api';

describe('uploadM0Files', () => {
  afterEach(() => {
    authRuntime.setCsrfToken(undefined);
    localStorage.clear();
  });

  it('uploads files and unwraps the batch envelope', async () => {
    server.use(
      http.post('/api/m0/import/upload', ({ request }) => {
        expect(new URL(request.url).searchParams.get('wait')).toBe('false');
        expect(request.headers.get('X-Yunpai-Task-ID')).toBe('task_m0_upload_1');
        return HttpResponse.json(
          {
            success: true,
            data: { id: 'M0-BATCH-002', status: 'received', source_names: 'a.pdf', stats: {}, tenant_id: 'default' },
            errors: [],
            trace_id: 'msw',
          },
          { status: 202 },
        );
      }),
    );
    const batch = await uploadM0Files([new File(['a'], 'a.pdf')], {
      intervalMs: 1,
      trackingTaskId: 'task_m0_upload_1',
    });
    expect(batch).toMatchObject({ id: 'M0-BATCH-002', status: 'received' });
  });

  it('normalizes persisted JSON strings and reports the source file count', async () => {
    server.use(
      http.get('/api/m0/import/batches', () => HttpResponse.json({
        success: true,
        data: { batches: [{
          id: 'M0-BATCH-JSON',
          status: 'awaiting_review',
          source_names: '["a.pdf","b.xlsx"]',
          stats: '{"documents":{"needs_review":2}}',
          tenant_id: 'default',
          created_by: '',
          created_at: '',
          updated_at: '',
        }] },
      })),
    );

    const { batches } = await listM0Batches();

    expect(batches[0]?.stats).toEqual({ documents: { needs_review: 2 } });
    expect(m0BatchFileCount(batches[0]!)).toBe(2);
  });

  it('replaces a stale received stage on a terminal batch', async () => {
    server.use(
      http.get('/api/m0/import/batches', () => HttpResponse.json({
        success: true,
        data: { batches: [{
          id: 'M0-BATCH-TERMINAL',
          status: 'committed',
          processing_stage: 'received',
          source_names: '[]',
          stats: {},
          tenant_id: 'default',
          created_by: '',
          created_at: '',
          updated_at: '',
        }] },
      })),
    );

    const { batches } = await listM0Batches();
    expect(batches[0]?.processing_stage).toBe('committed');
  });

  it('maps a gateway 504 to a friendly processing hint instead of a raw failure', async () => {
    server.use(
      http.post('/api/m0/import/upload', () => HttpResponse.text('Gateway Time-out', { status: 504 })),
    );
    await expect(uploadM0Files([new File(['a'], 'a.pdf')])).rejects.toThrow(
      '文件较大，服务端可能仍在处理，可稍后在「数据建设」页查看结果',
    );
  });

  it('keeps the durable batch id when the client polling window expires', async () => {
    server.use(
      http.post('/api/m0/import/upload', () =>
        HttpResponse.json(
          {
            success: true,
            data: { id: 'M0-BATCH-SLOW', status: 'received', source_names: 'a.pdf', stats: {}, tenant_id: 'default' },
            errors: [],
            trace_id: 'msw-slow',
          },
          { status: 202 },
        ),
      ),
      http.get('/api/m0/import/batch/M0-BATCH-SLOW', () =>
        HttpResponse.json({
          success: true,
          data: {
            batch: { id: 'M0-BATCH-SLOW', status: 'parsing', source_names: 'a.pdf', stats: {}, tenant_id: 'default' },
            documents: [],
            stats: {},
          },
          errors: [],
          trace_id: 'msw-slow',
        }),
      ),
    );

    try {
      await waitForM0Batch(
        { id: 'M0-BATCH-SLOW', status: 'received', source_names: 'a.pdf', stats: {}, tenant_id: 'default', created_by: '', created_at: '', updated_at: '' },
        { intervalMs: 1, timeoutMs: 2 },
      );
      throw new Error('expected the polling window to expire');
    } catch (error) {
      expect(error).toMatchObject({ name: 'M0BatchProcessingError', batch: { id: 'M0-BATCH-SLOW' } });
    }
  });
});
