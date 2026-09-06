#!/usr/bin/env node

const baseUrl = (process.env.API_GATEWAY_BASE_URL ?? 'http://127.0.0.1:8088').replace(/\/$/, '');
const timeoutMs = Number(process.env.API_GATEWAY_TIMEOUT_MS ?? 8000);
let authenticatedCookie = '';

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const request = async (path, init = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      redirect: 'manual',
      ...init,
      headers: {
        ...(authenticatedCookie ? { Cookie: authenticatedCookie } : {}),
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    const text = await response.text();
    const contentType = response.headers.get('content-type') ?? '';
    let json = null;
    if (contentType.includes('application/json') && text.length > 0) {
      json = JSON.parse(text);
    }
    return { response, text, json, contentType };
  } finally {
    clearTimeout(timeout);
  }
};

const streamRequest = async (path, init = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const started = performance.now();
    const response = await fetch(`${baseUrl}${path}`, {
      redirect: 'manual',
      ...init,
      headers: {
        ...(authenticatedCookie ? { Cookie: authenticatedCookie } : {}),
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') ?? '';
    assert(response.body, `${path} did not expose a ReadableStream`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const first = await reader.read();
    const firstChunkMs = performance.now() - started;
    const firstText = first.value ? decoder.decode(first.value, { stream: true }) : '';
    let rest = '';
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      rest += decoder.decode(next.value, { stream: true });
    }
    rest += decoder.decode();
    reader.releaseLock();
    return { response, contentType, firstText, rest, firstChunkMs };
  } finally {
    clearTimeout(timeout);
  }
};

const expectJsonRoute = async ({ method = 'GET', path, upstream, upstreamPath, query = '', init = {} }) => {
  const { response, json, text } = await request(path, {
    method,
    headers: {
      Accept: 'application/json',
      'X-Request-Id': 'smoke-request-id',
      'X-Trace-Id': 'smoke-trace-id',
      ...(init.headers ?? {}),
    },
    body: init.body,
  });

  assert(response.status === 200, `${method} ${path} expected 200, got ${response.status}: ${text}`);
  assert(json?.data?.upstream === upstream, `${method} ${path} expected upstream ${upstream}, got ${json?.data?.upstream}`);
  assert(json?.data?.path === upstreamPath, `${method} ${path} expected path ${upstreamPath}, got ${json?.data?.path}`);
  assert(json?.data?.query === query, `${method} ${path} expected query ${query}, got ${json?.data?.query}`);
  assert(json?.data?.headers?.xRequestId === 'smoke-request-id', `${method} ${path} did not pass X-Request-Id`);
  assert(json?.data?.headers?.xTraceId === 'smoke-trace-id', `${method} ${path} did not pass X-Trace-Id`);
  console.log(`${method} ${path} -> ${upstream}${upstreamPath}${query ? `?${query}` : ''}`);
  return json;
};

console.log(`API gateway smoke base URL: ${baseUrl}`);

const health = await request('/api/gateway/health');
assert(health.response.status === 200, `GET /api/gateway/health expected 200, got ${health.response.status}`);
assert(health.json?.data?.status === 'ok', 'gateway health did not return ok');
console.log('GET /api/gateway/health -> 200');

const unauthorized = await request('/api/orchestrator/health');
assert(unauthorized.response.status === 401, `unauthenticated orchestrator request expected 401, got ${unauthorized.response.status}`);
assert(unauthorized.contentType.includes('application/json'), 'unauthenticated response was not JSON');

const anonymous = await request('/api/auth/session/anonymous', { method: 'POST', headers: { Origin: baseUrl } });
assert(anonymous.response.status === 200, `anonymous session expected 200, got ${anonymous.response.status}`);
authenticatedCookie = (anonymous.response.headers.get('set-cookie') ?? '').split(';', 1)[0];
const csrfToken = anonymous.json?.session?.csrf_token;
assert(authenticatedCookie && csrfToken, 'anonymous session did not return cookie and CSRF token');

const authHeaders = { Cookie: authenticatedCookie };

const protectedHealth = await expectJsonRoute({
  path: '/api/orchestrator/health',
  upstream: 'orchestrator',
  upstreamPath: '/health',
  init: { headers: { ...authHeaders, Authorization: 'Bearer forged-browser-token', 'X-Tenant-ID': 'forged', 'X-Actor-ID': 'forged' } },
});
assert(protectedHealth.data.headers.authorization === 'Bearer smoke-internal-jwt', 'gateway did not replace external Authorization');
assert(protectedHealth.data.headers.xTenantId === null && protectedHealth.data.headers.xActorId === null, 'gateway forwarded forged identity headers');

const chatStream = await streamRequest('/api/orchestrator/chat/stream', {
  method: 'POST',
  headers: {
    Accept: 'application/x-ndjson',
    'Content-Type': 'application/json',
    'X-Request-Id': 'smoke-request-id',
    'X-Trace-Id': 'smoke-trace-id',
    ...authHeaders,
    Origin: baseUrl,
    'X-CSRF-Token': csrfToken,
  },
  body: JSON.stringify({ message: 'smoke', session_id: 'smoke' }),
});
assert(chatStream.response.status === 200, `POST /api/orchestrator/chat/stream expected 200, got ${chatStream.response.status}`);
assert(chatStream.contentType.includes('application/x-ndjson'), `chat stream expected NDJSON, got ${chatStream.contentType}`);
assert(chatStream.firstText.includes('"message_start"'), 'chat stream first chunk did not include message_start');
assert(!chatStream.firstText.includes('id="root"'), 'chat stream fell back to frontend HTML');
assert(chatStream.firstChunkMs < timeoutMs, `chat stream first chunk exceeded timeout: ${chatStream.firstChunkMs}ms`);
console.log('POST /api/orchestrator/chat/stream -> NDJSON stream');

if (process.env.API_GATEWAY_EXPECT_APP_503 === '1') {
  const failedStream = await streamRequest('/api/orchestrator/chat/stream?failure=503', {
    method: 'POST',
    headers: {
      Accept: 'application/x-ndjson',
      'Content-Type': 'application/json',
      ...authHeaders,
      Origin: baseUrl,
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({ message: 'history failure', session_id: 'smoke' }),
  });
  assert(failedStream.response.status === 503, `application failure expected 503, got ${failedStream.response.status}`);
  assert(failedStream.contentType.includes('application/json'), 'application 503 was not JSON');
  assert(failedStream.firstText.includes('chat_history_unavailable'), 'application 503 code was not preserved');
  assert(!failedStream.firstText.includes('message_start'), 'application 503 emitted an NDJSON message_start');
  console.log('POST /api/orchestrator/chat/stream -> application JSON 503 preserved');
}

await expectJsonRoute({
  path: '/api/m0/parser-compat/health',
  upstream: 'm1',
  upstreamPath: '/health',
});

await expectJsonRoute({
  path: '/api/m2/health',
  upstream: 'm2',
  upstreamPath: '/api/health',
});

await expectJsonRoute({
  path: '/api/m3/health',
  upstream: 'm3',
  upstreamPath: '/health',
});

await expectJsonRoute({
  path: '/api/m4/health',
  upstream: 'm4',
  upstreamPath: '/health',
});

await expectJsonRoute({
  path: '/api/m5/health',
  upstream: 'm5-api',
  upstreamPath: '/health',
});

await expectJsonRoute({
  path: '/api/m6/health',
  upstream: 'm6',
  upstreamPath: '/health',
});

await expectJsonRoute({
  path: '/api/m8/health',
  upstream: 'm8',
  upstreamPath: '/api/health',
});

await expectJsonRoute({
  path: '/api/m0/parser-compat/tasks?status=done',
  upstream: 'm1',
  upstreamPath: '/tasks',
  query: 'status=done',
});

const genericM3 = await expectJsonRoute({
  method: 'POST',
  path: '/api/m3/procurement-plan:run-json',
  upstream: 'm3',
  upstreamPath: '/api/v1/m3/procurement-plan:run-json',
  init: {
    headers: {
      ...authHeaders,
      Origin: baseUrl,
      'X-CSRF-Token': csrfToken,
      Authorization: 'Bearer forged-browser-token',
      'X-Yunpai-Principal': 'forged-principal',
      'X-Yunpai-Roles': 'admin',
      'X-Yunpai-Tenant': 'forged-tenant',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ procurementPlan: true }),
  },
});
assert(genericM3.data.headers.authorization === 'Bearer smoke-internal-jwt', 'ordinary M3 route did not use the BFF internal JWT');
assert(genericM3.data.headers.xYunpaiPrincipal === 'smoke-principal', 'ordinary M3 route did not replace the browser principal');
assert(genericM3.data.headers.xYunpaiRoles === 'shared_developer,reviewer', 'ordinary M3 route did not replace browser roles');
assert(genericM3.data.headers.xYunpaiTenant === '11111111-1111-4111-8111-111111111111', 'ordinary M3 route did not replace the browser tenant');

const standaloneM3 = await expectJsonRoute({
  method: 'POST',
  path: '/api/m3/procurement-requirements:run-json',
  upstream: 'm3',
  upstreamPath: '/api/v1/m3/procurement-requirements:run-json',
  init: {
    headers: {
      ...authHeaders,
      Origin: baseUrl,
      'X-CSRF-Token': csrfToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ procurementRequirements: true }),
  },
});
assert(standaloneM3.data.headers.authorization === 'Bearer smoke-m3-gateway-token', 'standalone M3 route did not use its dedicated gateway token');
assert(standaloneM3.data.headers.xYunpaiPrincipal === 'smoke-principal', 'standalone M3 route lost the verified principal');

const m4Import = await expectJsonRoute({
  method: 'POST',
  path: '/api/m4/suggestions/import-json',
  upstream: 'm4',
  upstreamPath: '/api/m4/suggestions/import-json',
  init: {
    headers: {
      ...authHeaders,
      Origin: baseUrl,
      'X-CSRF-Token': csrfToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ suggestions: [1] }),
  },
});
assert(m4Import.data.headers.authorization === 'Bearer smoke-m4-gateway-token', 'M4 route did not use its dedicated gateway token');

await expectJsonRoute({
  method: 'POST',
  path: '/api/m3/approval-tasks/task-1:approve',
  upstream: 'm3',
  upstreamPath: '/api/v1/m3/approval-tasks/task-1:approve',
  init: {
    headers: {
      ...authHeaders,
      Origin: baseUrl,
      'X-CSRF-Token': csrfToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ decision: 'approve' }),
  },
});

const jsonBody = await expectJsonRoute({
  method: 'POST',
  path: '/api/m2/run',
  upstream: 'm2',
  upstreamPath: '/api/run',
  init: {
    headers: {
      Origin: baseUrl,
      'X-CSRF-Token': csrfToken,
      Authorization: 'Bearer smoke-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ smoke: true, count: 1 }),
  },
});
assert(jsonBody.data.bodyText === '{"smoke":true,"count":1}', 'POST JSON body was not preserved');
assert(jsonBody.data.headers.authorization === 'Bearer smoke-internal-jwt', 'M2 route did not replace the browser Authorization header');

const formData = new FormData();
formData.append('file', new Blob(['smoke file content'], { type: 'text/plain' }), 'smoke.txt');
formData.append('kind', 'multipart');
const multipart = await expectJsonRoute({
  method: 'POST',
  path: '/api/m0/parser-compat/ingest',
  upstream: 'm1',
  upstreamPath: '/ingest',
  init: {
    headers: {
      Origin: baseUrl,
      'X-CSRF-Token': csrfToken,
    },
    body: formData,
  },
});
assert(multipart.data.bodyLength > 0, 'multipart body was empty after proxy');
assert(multipart.data.headers.contentType?.includes('multipart/form-data'), 'multipart Content-Type was not preserved');

const csv = await request('/api/m4/tracking/export.csv');
assert(csv.response.status === 200, `GET /api/m4/tracking/export.csv expected 200, got ${csv.response.status}`);
assert(csv.contentType.includes('text/csv'), `CSV response expected text/csv, got ${csv.contentType}`);
assert(csv.text.includes('id,status'), 'CSV response body was not preserved');
console.log('GET /api/m4/tracking/export.csv -> text/csv');

for (const path of ['/api/dashboard/summary', '/api/tasks', '/api/audit/logs', '/api/flow/agent']) {
  const { response, json, text } = await request(path);
  assert(response.status === 501, `${path} expected 501, got ${response.status}`);
  assert(json?.errors?.[0]?.code === 'NOT_IMPLEMENTED', `${path} did not return NOT_IMPLEMENTED JSON`);
  assert(!text.includes('id="root"'), `${path} fell back to frontend HTML`);
  console.log(`${path} -> 501 NOT_IMPLEMENTED`);
}

const demoLegal = await request('/api/demo/legal/risks');
assert(demoLegal.response.status === 501, `/api/demo/legal/risks expected 501, got ${demoLegal.response.status}`);
assert(demoLegal.json?.errors?.[0]?.code === 'NOT_IMPLEMENTED', '/api/demo/legal/risks did not return NOT_IMPLEMENTED JSON');
assert(!demoLegal.text.includes('id="root"'), '/api/demo/legal/risks fell back to frontend HTML');
console.log('/api/demo/legal/risks -> 501 NOT_IMPLEMENTED');

for (const path of ['/api/m7/unknown', '/api/legal/unknown']) {
  const result = await request(path);
  assert(result.response.status === 404, `${path} expected 404, got ${result.response.status}`);
  assert(result.json?.errors?.[0]?.code === 'NOT_FOUND', `${path} did not return NOT_FOUND JSON`);
  assert(!result.text.includes('id="root"'), `${path} fell back to frontend HTML`);
  console.log(`${path} -> 404 NOT_FOUND`);
}

console.log('API gateway smoke passed');
