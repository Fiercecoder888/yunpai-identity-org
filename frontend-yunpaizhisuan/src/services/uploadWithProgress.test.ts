import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../mocks/server';
import { authRuntime } from '../auth/authRuntime';
import {
  createM1BatchRecognitionWithProgress,
  continueTrackingRun,
  describeM0UploadError,
  isM0UploadOverGatewayLimit,
  m0ProcessingNote,
  m0UploadCompletedText,
  m0UploadOverLimitMessage,
  m0UploadTotalMb,
  uploadM0FilesWithProgress,
  uploadWithProgress,
} from './uploadWithProgress';

const envelope = (data: unknown) => ({ success: true, data, errors: [], trace_id: 'msw-upload' });

const m0Batch = {
  id: 'M0-BATCH-001',
  status: 'committed',
  source_names: 'a.csv',
  stats: {},
  tenant_id: 'default',
  created_by: 'test',
  created_at: '2026-08-10T00:00:00Z',
  updated_at: '2026-08-10T00:00:00Z',
};

describe('uploadWithProgress', () => {
  afterEach(() => {
    authRuntime.setCsrfToken(undefined);
    authRuntime.setRecovery(async () => false);
    localStorage.clear();
  });

  it('uploads m0 files via XHR and unwraps the envelope', async () => {
    const accepted = { ...m0Batch, status: 'received' };
    server.use(
      http.post('/api/m0/import/upload', ({ request }) => {
        expect(new URL(request.url).searchParams.get('wait')).toBe('false');
        expect(request.headers.get('X-Yunpai-Task-ID')).toBe('task_m0_progress_1');
        return HttpResponse.json(envelope(accepted), { status: 202 });
      }),
    );
    const batch = await uploadM0FilesWithProgress([new File(['a'], 'a.csv')], {
      pollIntervalMs: 1,
      trackingTaskId: 'task_m0_progress_1',
    });
    expect(batch).toMatchObject({ id: 'M0-BATCH-001', status: 'received' });
  });

  it('injects the explicit X-CSRF-Token header', async () => {
    authRuntime.setCsrfToken('csrf-token-1');
    let csrfSeen = '';
    server.use(
      http.post('/api/m0/import/upload', ({ request }) => {
        csrfSeen = request.headers.get('X-CSRF-Token') ?? '';
        return HttpResponse.json(envelope(m0Batch), { status: 202 });
      }),
    );
    await uploadM0FilesWithProgress([new File(['a'], 'a.csv')]);
    expect(csrfSeen).toBe('csrf-token-1');
  });

  it('recovers and retries once when an upload is rejected for stale CSRF', async () => {
    authRuntime.setCsrfToken('stale-upload-csrf');
    authRuntime.setRecovery(async () => {
      authRuntime.setCsrfToken('fresh-upload-csrf');
      return true;
    });
    const seenTokens: Array<string | null> = [];
    let attempts = 0;
    server.use(
      http.post('/api/upload-csrf-recovery', ({ request }) => {
        attempts += 1;
        seenTokens.push(request.headers.get('X-CSRF-Token'));
        if (attempts === 1) {
          return HttpResponse.json({ detail: { code: 'invalid_csrf' } }, { status: 403 });
        }
        return HttpResponse.json({ ok: true });
      }),
    );

    await expect(uploadWithProgress('/upload-csrf-recovery', new FormData())).resolves.toMatchObject({
      status: 200,
      data: { ok: true },
    });
    expect(seenTokens).toEqual(['stale-upload-csrf', 'fresh-upload-csrf']);
  });

  it('recovers once when nginx returns FORBIDDEN for a stale upload CSRF token', async () => {
    authRuntime.setCsrfToken('stale-gateway-upload-csrf');
    authRuntime.setRecovery(async () => {
      authRuntime.setCsrfToken('fresh-gateway-upload-csrf');
      return true;
    });
    const seenTokens: Array<string | null> = [];
    let attempts = 0;
    server.use(
      http.post('/api/upload-gateway-csrf-recovery', ({ request }) => {
        attempts += 1;
        seenTokens.push(request.headers.get('X-CSRF-Token'));
        if (attempts === 1) {
          return HttpResponse.json({ code: 'FORBIDDEN' }, { status: 403 });
        }
        return HttpResponse.json({ ok: true });
      }),
    );

    await expect(uploadWithProgress('/upload-gateway-csrf-recovery', new FormData())).resolves.toMatchObject({
      status: 200,
      data: { ok: true },
    });
    expect(seenTokens).toEqual(['stale-gateway-upload-csrf', 'fresh-gateway-upload-csrf']);
  });

  it('propagates the explicit tracking task id on M1 progress uploads', async () => {
    let taskId = '';
    server.use(
      http.post('/api/m0/parser-compat/ingest/batch', ({ request }) => {
        taskId = request.headers.get('X-Yunpai-Task-ID') ?? '';
        return HttpResponse.json({ task_id: 'm1-parent', parent_id: 'm1-parent', child_ids: [], accepted_file_count: 1, async: true, poll_url: '/batch/m1-parent' }, { status: 202 });
      }),
    );
    await createM1BatchRecognitionWithProgress([new File(['a'], 'a.csv')], { source: 'manual', documentType: 'drawing', priority: 'normal' }, { trackingTaskId: 'task-m1-progress-1' });
    expect(taskId).toBe('task-m1-progress-1');
  });

  it('rejects with session-expired copy when 401 recovery is unavailable', async () => {
    server.use(
      http.post('/api/m0/import/upload', () => HttpResponse.json({ message: 'unauthorized' }, { status: 401 })),
    );
    await expect(uploadM0FilesWithProgress([new File(['a'], 'a.csv')])).rejects.toThrow('会话已过期，请重新登录');
  });

  it('rejects m0 uploads with a friendly processing hint on gateway 504', async () => {
    server.use(
      http.post('/api/m0/import/upload', () => HttpResponse.text('Gateway Time-out', { status: 504 })),
    );
    await expect(uploadM0FilesWithProgress([new File(['a'], 'a.csv')])).rejects.toThrow(
      '文件较大，服务端可能仍在处理，可稍后在「数据建设」页查看结果',
    );
  });

  it('rejects with AbortError when the caller aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadWithProgress('/m0/import/upload', 'body', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('continueTrackingRun resumes polling from candidate runs', async () => {
    localStorage.setItem(
      'yunpai-candidate-runs',
      JSON.stringify({ 'upload-o.xlsx': { task_id: 'task-9', run_id: 'R-9' } }),
    );
    server.use(
      http.get('/api/orchestrator/business-flows/R-9', () =>
        HttpResponse.json({
          run_id: 'R-9',
          tracking_task_id: 'task-9',
          requested_order_id: 'o',
          order_id: 'o',
          mode: 'real',
          status: 'completed',
          current_node: 'persist_trace',
          steps: [],
        }),
      ),
    );
    const result = await continueTrackingRun('R-9', { maxAttempts: 2, intervalMs: 1 });
    expect(result).toMatchObject({ taskId: 'task-9' });
    expect(result.run?.status).toBe('completed');
  });
});

describe('m0 upload feedback helpers', () => {
  it('computes the total upload size in MiB', () => {
    expect(m0UploadTotalMb([{ size: 50 * 1024 * 1024 }, { size: 50 * 1024 * 1024 }])).toBe(100);
    expect(m0UploadTotalMb([])).toBe(0);
  });

  it('allows the former 143MiB failure and reserves multipart headroom below 200MiB', () => {
    expect(isM0UploadOverGatewayLimit([{ size: 200 * 1024 * 1024 }])).toBe(true);
    expect(isM0UploadOverGatewayLimit([{ size: 143 * 1024 * 1024 }])).toBe(false);
    expect(isM0UploadOverGatewayLimit([])).toBe(false);
  });

  it('builds a clear pre-upload warning for oversized uploads', () => {
    expect(m0UploadOverLimitMessage([{ size: 200 * 1024 * 1024 }])).toContain('超过网关单请求上限');
    expect(m0UploadOverLimitMessage([{ size: 200 * 1024 * 1024 }])).toContain('拆分文件');
  });

  it('explains gateway 413 failures without masking ordinary HTTP 500 errors', () => {
    expect(describeM0UploadError(new Error('413 Request Entity Too Large'))).toContain('上传被网关拒绝');
    expect(describeM0UploadError(new Error('client intended to send too large body'))).toContain('上传被网关拒绝');
    expect(describeM0UploadError(new Error('Request body is too large; gateway limit is 200 MiB'))).toContain('上传被网关拒绝');
    expect(describeM0UploadError(new Error('请求失败（HTTP 500）'))).toBe('请求失败（HTTP 500）');
  });

  it('keeps friendly processing hints, cancel copy, and fallback copy verbatim', () => {
    const hint = '文件较大，服务端可能仍在处理，可稍后在「数据建设」页查看结果';
    expect(describeM0UploadError(new Error(`上传超时：${hint}`))).toBe(`上传超时：${hint}`);
    expect(describeM0UploadError(new DOMException('上传已取消', 'AbortError'))).toBe('上传已取消');
    expect(describeM0UploadError('boom')).toBe('m0 导入失败，请检查文件');
  });

  it('builds the transfer-complete server-processing text with a large-file note only for big uploads', () => {
    const large = m0UploadCompletedText(true);
    const small = m0UploadCompletedText(false);
    expect(large).toContain('传输完成，服务端处理中');
    expect(large).toContain('大文件解压/识别可能需要几分钟');
    expect(small).toContain('传输完成，服务端处理中');
    expect(small).not.toContain('大文件');
  });

  it('adds the large-file processing note only for large files or long waits', () => {
    expect(m0ProcessingNote({ large: true })).toContain('大文件解压/识别可能需要几分钟');
    expect(m0ProcessingNote({ slow: true })).toContain('大文件解压/识别可能需要几分钟');
    expect(m0ProcessingNote({ large: false, slow: false })).toBe('');
    expect(m0ProcessingNote()).toBe('');
  });
});
