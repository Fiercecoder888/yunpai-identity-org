import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import {
  confirmReviewItem,
  createArchiveRecognition,
  createBatchRecognition,
  createSingleRecognition,
  createSyncRecognition,
  deleteM1Task,
  downloadM1Report,
  generateM1Report,
  getM1Batch,
  getM1ReviewItems,
  getM1Task,
  listM1Tasks,
  previewM1File,
} from './m1Api';

describe('m1Api', () => {
  it('uploads a single file with FormData and metadata', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ taskId: 'TASK-1' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const response = await createSingleRecognition(new File(['demo'], 'demo.pdf', { type: 'application/pdf' }), {
      source: 'manual',
      documentType: 'drawing',
      priority: 'normal',
    });

    const init = fetchSpy.mock.calls[0]?.[1];
    expect(response).toEqual({ taskId: 'TASK-1' });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/m0/parser-compat/ingest');
    expect(init?.body).toBeInstanceOf(FormData);
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false);
    expect(new Headers(init?.headers).get('X-Yunpai-Task-ID')).toMatch(/^task_[a-f0-9]{32}$/);

    fetchSpy.mockRestore();
  });

  it('reuses an explicit tracking task id for every upload shape', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(new Headers(init?.headers).get('X-Yunpai-Task-ID')).toBe('task-m1-root-1');
      return new Response(JSON.stringify({ task_id: 'TASK-1', parent_id: 'TASK-1', accepted_file_count: 1, async: true, poll_url: '/batch/TASK-1' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const file = new File(['demo'], 'demo.pdf', { type: 'application/pdf' });
    await createSingleRecognition(file, { source: 'manual', documentType: 'drawing', priority: 'normal' }, { trackingTaskId: 'task-m1-root-1' });
    await createSyncRecognition(file, { source: 'manual', documentType: 'drawing', priority: 'normal' }, { trackingTaskId: 'task-m1-root-1' });
    await createBatchRecognition([file], { source: 'manual', documentType: 'drawing', priority: 'normal' }, { trackingTaskId: 'task-m1-root-1' });
    await createArchiveRecognition(file, { source: 'archive', documentType: 'drawing', priority: 'normal' }, { trackingTaskId: 'task-m1-root-1' });

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    fetchSpy.mockRestore();
  });

  it('uploads batch files with FormData', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        task_id: 'TASK-1',
        parent_id: 'TASK-1',
        child_ids: ['TASK-2', 'TASK-3'],
        status: 'created',
        processing_stage: 'batch_queued',
        accepted_file_count: 2,
        async: true,
        poll_url: '/batch/TASK-1',
      }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const response = await createBatchRecognition(
      [new File(['demo'], 'a.pdf', { type: 'application/pdf' }), new File(['demo'], 'b.png', { type: 'image/png' })],
      { source: 'manual', documentType: 'drawing', priority: 'normal' },
    );

    const init = fetchSpy.mock.calls[0]?.[1];
    expect(response).toEqual({ taskIds: ['TASK-1'], failedFiles: [], parentId: 'TASK-1' });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/m0/parser-compat/ingest/batch');
    expect(init?.body).toBeInstanceOf(FormData);

    fetchSpy.mockRestore();
  });

  it('uploads ZIP archives with FormData', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ taskId: 'TASK-ZIP', extractedFiles: 3, failedFiles: [] }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const response = await createArchiveRecognition(new File(['demo'], 'archive.zip', { type: 'application/zip' }), {
      source: 'archive',
      documentType: 'drawing',
      priority: 'normal',
    });

    const init = fetchSpy.mock.calls[0]?.[1];
    expect(response).toEqual({ taskId: 'TASK-ZIP', extractedFiles: 3, failedFiles: [] });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/m0/parser-compat/ingest/archive');
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get('file')).toBeInstanceOf(File);
    expect((init?.body as FormData).has('archive')).toBe(false);

    fetchSpy.mockRestore();
  });

  it('uses new gateway paths for tasks, review, preview, report and delete facades', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'M1-TASK-001' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'M1-TASK-001' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('preview', { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'M1-REV-1', taskId: 'M1-TASK-001', field: '交付日期', recognizedValue: '2026-07-08', confidence: 0.6, status: 'confirmed' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ taskId: 'M1-TASK-001', status: 'generated' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('report', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ taskId: 'M1-TASK-001', deleted: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await getM1Batch('parent-1');
    await getM1Task('M1-TASK-001');
    await previewM1File('M1-TASK-001');
    await confirmReviewItem(
      {
        id: 'M1-TASK-001:交付日期',
        taskId: 'M1-TASK-001',
        field: '交付日期',
        recognizedValue: '2026-07-08',
        confidence: 0.6,
        status: 'pending',
      },
      { correctedValue: '2026-07-09', reason: '人工修正' },
    );
    await generateM1Report('M1-TASK-001');
    await downloadM1Report('M1-TASK-001');
    await deleteM1Task('M1-TASK-001');

    expect(fetchSpy.mock.calls.map((call) => call[0])).toEqual([
      '/api/m0/parser-compat/batch/parent-1',
      '/api/m0/parser-compat/tasks/M1-TASK-001',
      '/api/m0/parser-compat/files/M1-TASK-001',
      '/api/m0/parser-compat/review/M1-TASK-001?approve=true&reviewer=frontend-reviewer&comment=%E4%BA%BA%E5%B7%A5%E4%BF%AE%E6%AD%A3',
      '/api/m0/parser-compat/tasks/M1-TASK-001/report',
      '/api/m0/parser-compat/tasks/M1-TASK-001/report/download',
      '/api/m0/parser-compat/tasks/M1-TASK-001',
    ]);

    fetchSpy.mockRestore();
  });

  it('reads low-confidence fields directly from the bounded review queue', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ task_id: 'TASK-REVIEW-1', status: 'needs_review', review_fields: [
            { name: 'title_block.material', value_preview: '', confidence: 0.28, value_truncated: false },
          ] }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    await expect(getM1ReviewItems()).resolves.toEqual([
      {
        id: 'TASK-REVIEW-1:title_block.material',
        taskId: 'TASK-REVIEW-1',
        field: 'title_block.material',
        recognizedValue: '',
        confidence: 0.28,
        status: 'pending',
      },
    ]);
    expect(fetchSpy.mock.calls.map((call) => call[0])).toEqual(['/api/m0/parser-compat/review/queue']);

    fetchSpy.mockRestore();
  });

  it('normalizes M1 HTTP 4xx and 5xx failures', async () => {
    server.use(http.get('/api/m0/parser-compat/tasks', () => HttpResponse.json({ message: 'bad status' }, { status: 400 })));
    await expect(listM1Tasks()).rejects.toMatchObject({ error: { code: 'server_error', status: 400 } });

    server.use(http.get('/api/m0/parser-compat/tasks', () => HttpResponse.json({ message: 'server down' }, { status: 500 })));
    await expect(listM1Tasks()).rejects.toMatchObject({ error: { code: 'server_error', status: 500 } });
  });
});
