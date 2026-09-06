import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authRuntime } from '../auth/authRuntime';
import { server } from '../mocks/server';
import { DEFAULT_REQUEST_TIMEOUT_MS, requestBlob, requestJson, requestText } from './httpClient';

describe('httpClient', () => {
  afterEach(() => {
    authRuntime.setCsrfToken(undefined);
    authRuntime.setRecovery(async () => false);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('requests relative /api paths when no base URL is configured', async () => {
    const data = await requestJson('/dashboard/module-statuses');

    expect(Array.isArray(data)).toBe(true);
  });

  it('bridges caller abort to the underlying fetch signal exactly once', async () => {
    const caller = new AbortController();
    let aborts = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        aborts += 1;
        reject(new DOMException('aborted', 'AbortError'));
      }, { once: true });
    }));

    const pending = requestJson('/api/abort-bridge', { signal: caller.signal, timeoutMs: 10_000 });
    caller.abort();
    await expect(pending).rejects.toMatchObject({ error: { code: 'network_error' } });
    expect(fetchSpy.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(aborts).toBe(1);
  });


  it('sends the in-memory CSRF token on authenticated GET requests', async () => {
    authRuntime.setCsrfToken('runtime-csrf');
    server.use(
      http.get('/api/csrf-check', ({ request }) => {
        expect(request.headers.get('X-CSRF-Token')).toBe('runtime-csrf');
        return HttpResponse.json({ ok: true });
      }),
    );

    await expect(requestJson('/api/csrf-check')).resolves.toEqual({ ok: true });
  });

  it('refreshes the CSRF token when retrying an authenticated GET after recovery', async () => {
    authRuntime.setCsrfToken('stale-runtime-csrf');
    authRuntime.setRecovery(async () => {
      authRuntime.setCsrfToken('fresh-runtime-csrf');
      return true;
    });
    const seenTokens: Array<string | null> = [];
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(async (_input, init) => {
        seenTokens.push(new Headers(init?.headers).get('X-CSRF-Token'));
        return new Response(JSON.stringify({ code: 'session_required' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      })
      .mockImplementationOnce(async (_input, init) => {
        seenTokens.push(new Headers(init?.headers).get('X-CSRF-Token'));
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

    await expect(requestJson('/api/recovery-check')).resolves.toEqual({ ok: true });

    expect(seenTokens).toEqual(['stale-runtime-csrf', 'fresh-runtime-csrf']);
  });

  it('recovers and retries once when the gateway rejects a stale CSRF token', async () => {
    authRuntime.setCsrfToken('stale-runtime-csrf');
    authRuntime.setRecovery(async () => {
      authRuntime.setCsrfToken('fresh-runtime-csrf');
      return true;
    });
    const seenTokens: Array<string | null> = [];
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(async (_input, init) => {
        seenTokens.push(new Headers(init?.headers).get('X-CSRF-Token'));
        return new Response(JSON.stringify({ detail: { code: 'invalid_csrf' } }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      })
      .mockImplementationOnce(async (_input, init) => {
        seenTokens.push(new Headers(init?.headers).get('X-CSRF-Token'));
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

    await expect(requestJson('/api/csrf-recovery-check', { method: 'POST', body: { ok: true } })).resolves.toEqual({ ok: true });
    expect(seenTokens).toEqual(['stale-runtime-csrf', 'fresh-runtime-csrf']);
  });

  it('recovers once when nginx collapses stale CSRF into FORBIDDEN', async () => {
    authRuntime.setCsrfToken('stale-gateway-csrf');
    authRuntime.setRecovery(async () => {
      authRuntime.setCsrfToken('fresh-gateway-csrf');
      return true;
    });
    const seenTokens: Array<string | null> = [];
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(async (_input, init) => {
        seenTokens.push(new Headers(init?.headers).get('X-CSRF-Token'));
        return new Response(JSON.stringify({ code: 'FORBIDDEN' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      })
      .mockImplementationOnce(async (_input, init) => {
        seenTokens.push(new Headers(init?.headers).get('X-CSRF-Token'));
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

    await expect(requestJson('/api/gateway-csrf-check', { method: 'POST', body: {} })).resolves.toEqual({ ok: true });
    expect(seenTokens).toEqual(['stale-gateway-csrf', 'fresh-gateway-csrf']);
  });

  it('does not retry a permission-denied 403 response', async () => {
    const recover = vi.fn(async () => true);
    authRuntime.setRecovery(recover);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'missing permission: m4:operate' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(requestJson('/api/permission-check', { method: 'POST', body: {} })).rejects.toMatchObject({
      error: { code: 'forbidden', status: 403 },
    });
    expect(recover).not.toHaveBeenCalled();
  });

  it('sends JSON requests with application/json content type', async () => {
    server.use(
      http.post('/api/json-check', async ({ request }) => {
        expect(request.headers.get('content-type')).toContain('application/json');
        return HttpResponse.json(await request.json());
      }),
      http.patch('/api/json-check', async ({ request }) => {
        expect(request.headers.get('content-type')).toContain('application/json');
        return HttpResponse.json({ method: request.method, body: await request.json() });
      }),
      http.delete('/api/json-check', async ({ request }) => HttpResponse.json({ method: request.method })),
    );

    await expect(requestJson('/api/json-check', { method: 'POST', body: { ok: true } })).resolves.toEqual({ ok: true });
    await expect(requestJson('/api/json-check', { method: 'PATCH', body: { ok: true } })).resolves.toEqual({
      method: 'PATCH',
      body: { ok: true },
    });
    await expect(requestJson('/api/json-check', { method: 'DELETE' })).resolves.toEqual({ method: 'DELETE' });
  });

  it('does not write Content-Type for FormData requests', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const formData = new FormData();
    formData.append('file', new Blob(['demo']), 'demo.pdf');

    await expect(requestJson('/api/form-check', { method: 'POST', body: formData })).resolves.toEqual({ ok: true });

    const init = fetchSpy.mock.calls[0]?.[1];
    expect(init?.body).toBe(formData);
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false);

    fetchSpy.mockRestore();
  });

  it('uses VITE_API_BASE_URL for relative paths', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(requestJson('/health')).resolves.toEqual({ ok: true });

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/health');
  });

  it('reads text responses without JSON parsing', async () => {
    server.use(http.get('/api/text-check.csv', () => HttpResponse.text('id,name\n1,A', { headers: { 'Content-Type': 'text/csv' } })));

    await expect(requestText('/text-check.csv')).resolves.toContain('id,name');
  });

  it('reads blob responses without JSON parsing', async () => {
    server.use(http.get('/api/blob-check', () => new HttpResponse(new Blob(['demo'], { type: 'application/octet-stream' }))));

    const blob = await requestBlob('/blob-check');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('normalizes forbidden errors', async () => {
    server.use(http.get('/api/forbidden-check', () => HttpResponse.json({ message: 'No permission' }, { status: 403 })));

    await expect(requestJson('/api/forbidden-check')).rejects.toMatchObject({
      error: { code: 'forbidden', status: 403 },
    });
  });

  it('normalizes bad request errors', async () => {
    server.use(http.get('/api/bad-request-check', () => HttpResponse.json({ message: 'Bad request' }, { status: 400 })));

    await expect(requestJson('/api/bad-request-check')).rejects.toMatchObject({
      error: { code: 'server_error', status: 400 },
    });
  });

  it('normalizes server errors', async () => {
    server.use(http.get('/api/server-error-check', () => HttpResponse.json({ message: 'Broken' }, { status: 500 })));

    await expect(requestJson('/api/server-error-check')).rejects.toMatchObject({
      error: { code: 'server_error', status: 500 },
    });
  });

  it('surfaces nested FastAPI conflict details', async () => {
    server.use(http.post('/api/conflict-check', () => HttpResponse.json({
      detail: {
        code: 'business_flow_idempotency_conflict',
        message: 'Tracking TaskID already belongs to a different business flow payload',
      },
    }, { status: 409 })));

    await expect(requestJson('/api/conflict-check', { method: 'POST', body: {} })).rejects.toMatchObject({
      error: {
        code: 'business_flow_idempotency_conflict',
        status: 409,
        message: 'Tracking TaskID already belongs to a different business flow payload',
      },
    });
  });

  it('normalizes non-JSON responses', async () => {
    server.use(http.get('/api/non-json-check', () => new Response('not json', { status: 200 })));

    await expect(requestJson('/api/non-json-check')).rejects.toMatchObject({
      error: { code: 'parse_error', status: 200 },
    });
  });

  it('normalizes network errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'));

    await expect(requestJson('/api/network-error-check')).rejects.toMatchObject({
      error: { code: 'network_error' },
    });
  });

  it('keeps fetch rejects as network errors even when timeoutMs is configured', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('connection refused'));

    await expect(requestJson('/api/network-error-with-timeout-check', { timeoutMs: 10_000 })).rejects.toMatchObject({
      error: { code: 'network_error' },
    });
  });

  it('does not classify external AbortSignal cancellation as an internal timeout', async () => {
    const controller = new AbortController();
    const abortingFetch: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted by caller', 'AbortError')), { once: true });
        controller.abort();
      });
    vi.spyOn(globalThis, 'fetch').mockImplementation(abortingFetch);

    await expect(requestJson('/api/external-abort-check', { signal: controller.signal, timeoutMs: 10_000 })).rejects.toMatchObject({
      error: { code: 'network_error' },
    });
  });

  it('normalizes timed out requests', async () => {
    const neverFetch: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
    vi.spyOn(globalThis, 'fetch').mockImplementation(neverFetch);

    await expect(requestJson('/api/slow-check', { timeoutMs: 1 })).rejects.toMatchObject({
      error: { code: 'timeout' },
    });
  });

  it('applies the default request timeout when timeoutMs is omitted', async () => {
    vi.useFakeTimers();
    const neverFetch: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
    vi.spyOn(globalThis, 'fetch').mockImplementation(neverFetch);

    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(60_000);
    const pending = requestJson('/api/default-timeout-check');
    const assertion = expect(pending).rejects.toMatchObject({
      error: { code: 'timeout', message: 'Request timed out' },
    });
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS + 1);
    await assertion;
  });

});
