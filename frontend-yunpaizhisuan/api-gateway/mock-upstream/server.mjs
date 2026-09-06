import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 8000);
const upstreamName = process.env.UPSTREAM_NAME ?? 'mock-upstream';

const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const sendJson = (response, status, payload) => {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
};

const server = createServer(async (request, response) => {
  const body = await readBody(request);
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const bodySha256 = createHash('sha256').update(body).digest('hex');

  if (upstreamName === 'identity-bff') {
    if (url.pathname === '/api/auth/config') {
      sendJson(response, 200, { auth_mode: 'shared_anonymous', oidc_enabled: false, shared_data: true, csrf_required: true,
        capabilities: { anonymous_session: true, oidc_login: false, session_management: true, user_isolation: false } });
      return;
    }
    if (url.pathname === '/api/auth/session/anonymous') {
      const payload = { auth_mode: 'shared_anonymous', principal_type: 'shared_anonymous', user: null,
        tenant: { id: '11111111-1111-4111-8111-111111111111', name: 'Shared test tenant' }, shared_data: true,
        roles: ['shared_developer', 'reviewer'], permissions: ['chat:read', 'chat:write', 'chat:delete', 'm0:bom:approve', 'm4:operate'],
        session: { id: 'smoke-session', csrf_token: 'smoke-csrf', idle_expires_at: '2099-01-01T00:00:00Z', absolute_expires_at: '2099-01-01T00:00:00Z' } };
      const payloadBody = JSON.stringify(payload);
      response.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'yunpai_session=smoke-cookie; HttpOnly; SameSite=Lax; Path=/', 'Content-Length': Buffer.byteLength(payloadBody) });
      response.end(payloadBody);
      return;
    }
    if (url.pathname === '/internal/auth/verify') {
      if (!request.headers.cookie?.includes('yunpai_session=smoke-cookie')) {
        sendJson(response, 401, { code: 'session_required' });
        return;
      }
      const unsafe = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(request.headers['x-original-method']).toUpperCase());
      if (unsafe && request.headers['x-csrf-token'] !== 'smoke-csrf') {
        sendJson(response, 403, { code: 'invalid_csrf' });
        return;
      }
      response.writeHead(204, {
        'X-Yunpai-Internal-Authorization': 'Bearer smoke-internal-jwt',
        'X-Yunpai-Principal': 'smoke-principal',
        'X-Yunpai-Roles': 'shared_developer,reviewer',
        'X-Yunpai-Tenant': '11111111-1111-4111-8111-111111111111',
        'X-Yunpai-Data-Scope': '33333333-3333-4333-8333-333333333333',
        'X-Yunpai-User-Name': 'Smoke%20Developer',
        'X-Yunpai-User-Name-Encoding': 'percent-utf8',
      });
      response.end();
      return;
    }
  }

  if (url.pathname.endsWith('.csv')) {
    const csv = 'id,status\n1,ok\n';
    response.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(csv),
    });
    response.end(csv);
    return;
  }

  if (url.pathname.endsWith('.txt')) {
    const text = `mock text response from ${upstreamName}\n`;
    response.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(text),
    });
    response.end(text);
    return;
  }

  if (upstreamName === 'orchestrator' && url.pathname === '/chat/stream') {
    const failureStatus = Number(url.searchParams.get('failure') ?? process.env.ORCHESTRATOR_FAILURE_STATUS ?? 0);
    if (failureStatus) {
      sendJson(response, failureStatus, { code: 'chat_history_unavailable' });
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
    response.write(
      '{"type":"message_start","message_id":"msg_smoke","session_id":"smoke","conversation_id":"assistant","created_at":"2026-07-16T00:00:00Z"}\n',
    );
    setTimeout(() => {
      response.write('{"type":"delta","message_id":"msg_smoke","content":"smoke delta"}\n');
      response.end('{"type":"message_done","message_id":"msg_smoke","finish_reason":"stop","usage":{"input_tokens":0,"output_tokens":0}}\n');
    }, 25);
    return;
  }

  sendJson(response, 200, {
    success: true,
    data: {
      upstream: upstreamName,
      method: request.method,
      path: url.pathname,
      query: url.searchParams.toString(),
      url: request.url,
      bodyLength: body.length,
      bodyText: body.toString('utf8'),
      bodySha256,
      headers: {
        authorization: request.headers.authorization ?? null,
        contentType: request.headers['content-type'] ?? null,
        accept: request.headers.accept ?? null,
        xRequestId: request.headers['x-request-id'] ?? null,
        xTraceId: request.headers['x-trace-id'] ?? null,
        xTenantId: request.headers['x-tenant-id'] ?? null,
        xActorId: request.headers['x-actor-id'] ?? null,
        xYunpaiPrincipal: request.headers['x-yunpai-principal'] ?? null,
        xYunpaiRoles: request.headers['x-yunpai-roles'] ?? null,
        xYunpaiTenant: request.headers['x-yunpai-tenant'] ?? null,
        xYunpaiDataScope: request.headers['x-yunpai-data-scope'] ?? null,
      },
    },
    errors: [],
    trace_id: request.headers['x-trace-id'] ?? request.headers['x-request-id'] ?? null,
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`${upstreamName} mock upstream listening on ${port}`);
});
