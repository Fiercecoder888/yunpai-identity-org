#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = (process.env.REAL_E2E_BASE_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
const evidenceDir = process.env.REAL_E2E_EVIDENCE_DIR ?? path.join('evidence', 'real-e2e-20260711');
const timeoutMs = Number(process.env.REAL_E2E_TIMEOUT_MS ?? 8000);

const requests = [
  { id: 'frontend-root', method: 'GET', path: '/', expectation: 'frontend-html', realBackend: false },
  { id: 'frontend-dashboard', method: 'GET', path: '/dashboard', expectation: 'frontend-html', realBackend: false },
  { id: 'gateway-health', method: 'GET', path: '/api/gateway/health', expectation: 'gateway-json-200', realBackend: false },
  { id: 'gateway-routes', method: 'GET', path: '/api/gateway/routes', expectation: 'gateway-json-200', realBackend: false },
  { id: 'orchestrator-health', method: 'GET', path: '/api/orchestrator/health', expectation: 'real-backend-health', realBackend: true },
  { id: 'm1-health', method: 'GET', path: '/api/m0/parser-compat/health', expectation: 'real-backend-health', realBackend: true },
  { id: 'm2-health', method: 'GET', path: '/api/m2/health', expectation: 'real-backend-health', realBackend: true },
  { id: 'm3-health', method: 'GET', path: '/api/m3/health', expectation: 'real-backend-health', realBackend: true },
  { id: 'm4-health', method: 'GET', path: '/api/m4/health', expectation: 'real-backend-health', realBackend: true },
  { id: 'm5-health', method: 'GET', path: '/api/m5/health', expectation: 'real-backend-health', realBackend: true },
  { id: 'm6-health', method: 'GET', path: '/api/m6/health', expectation: 'real-backend-health', realBackend: true },
  { id: 'm8-health', method: 'GET', path: '/api/m8/health', expectation: 'real-backend-health', realBackend: true },
  { id: 'dashboard-summary', method: 'GET', path: '/api/dashboard/summary', expectation: 'aggregate-placeholder', realBackend: false },
  { id: 'demo-legal-risks', method: 'GET', path: '/api/demo/legal/risks', expectation: 'demo-placeholder', realBackend: false },
  { id: 'not-configured', method: 'GET', path: '/api/not-configured', expectation: 'not-configured', realBackend: false },
  { id: 'm1-tasks-query', method: 'GET', path: '/api/m0/parser-compat/tasks?status=done', expectation: 'real-backend-explicit', realBackend: true },
  {
    id: 'm3-colon-route',
    method: 'POST',
    path: '/api/m3/procurement-plan:run-json',
    expectation: 'real-backend-explicit',
    realBackend: true,
    body: {
      order: {
        project_id: 'P-001',
        order_id: 'ORD-001',
        bom_id: 'BOM-001',
        product_name: 'Smoke Product',
        order_qty: 1,
        due_date: '2026-07-31',
      },
      bom: {
        bom_id: 'BOM-001',
        product_name: 'Smoke Product',
        lines: [
          {
            material_code: 'MAT-001',
            material_name: 'Smoke Material',
            qty_raw: 1,
            qty_per: 1,
            uom: 'PCS',
            requires_procurement: true,
          },
        ],
      },
    },
  },
  {
    id: 'm4-colon-route',
    method: 'POST',
    path: '/api/m4/suggestions/import-json',
    expectation: 'm4-import-json',
    realBackend: true,
    body: {
      suggestions: [
        {
          item_code: 'SMOKE-MAT-001',
          item_name: '联调验收物料',
          quantity: 8,
          unit: 'PCS',
          supplier_name: '联调验收供应商',
          required_date: '2026-08-31',
          project_code: 'SMOKE-PROJECT-001',
          remark: 'M4 gateway route smoke',
        },
      ],
      tenant_id: '11111111-1111-4111-8111-111111111111',
      site_id: 'SITE-1',
      tracking_task_id: 'task_frontend_m4_route_smoke_v1',
      idempotency_key: 'frontend-m4-route-smoke-v1',
      source_module: 'm3',
      procurement_plan_id: 'SMOKE-PLAN-001',
      procurement_plan_version_id: 'v1',
      source_plan_checksum: 'sha256:frontend-m4-route-smoke-v1',
      order_id: 'SMOKE-ORDER-001',
      source_event_id: 'smoke-m3-suggestions-v1',
      observed_at: '2026-08-18T00:00:00Z',
    },
  },
  { id: 'm4-tracking-csv', method: 'GET', path: '/api/m4/tracking/export.csv', expectation: 'csv-or-error', realBackend: true },
];

const htmlRootPattern = /id=["']root["']/i;
const htmlDocPattern = /^\s*<!doctype html|^\s*<html[\s>]/i;
const acceptableExplicitStatuses = new Set([200, 201, 202, 204, 400, 401, 403, 404, 405, 422]);

const hasHtml = (contentType, body) => contentType.includes('text/html') || htmlDocPattern.test(body) || htmlRootPattern.test(body);
const hasJson = (contentType, json) => contentType.includes('application/json') && json !== null;
const redactSensitive = (value) =>
  String(value ?? '')
    .replace(/sk-[A-Za-z0-9_-]{12,}/gi, '<REDACTED_SECRET>')
    .replace(/((?:api[_-]?key|token|password)["']?\s*[:=]\s*["']?)[A-Za-z0-9_./+-]{16,}/gi, '$1<REDACTED_SECRET>');
const summarize = (body) => redactSensitive(body).replace(/\s+/g, ' ').trim().slice(0, 500);
const markdownCell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

const safeFileName = (index, id) => `${String(index + 1).padStart(2, '0')}-${id}.txt`;
const formatError = (error) => {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause = error.cause;
  if (cause && typeof cause === 'object') {
    const causeRecord = cause;
    const causeCode = 'code' in causeRecord ? causeRecord.code : null;
    const causeMessage = 'message' in causeRecord ? causeRecord.message : null;
    return [error.message, causeCode, causeMessage].filter(Boolean).join(' | ');
  }
  return error.message;
};

const request = async (item) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { Accept: 'application/json, text/csv, text/plain, */*' };
  const init = { method: item.method, redirect: 'manual', signal: controller.signal, headers };

  if (item.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(item.body);
  }

  try {
    const response = await fetch(`${baseUrl}${item.path}`, init);
    const body = await response.text();
    const contentType = response.headers.get('content-type') ?? '';
    let json = null;
    let jsonParseError = null;

    if (contentType.includes('application/json') && body.length > 0) {
      try {
        json = JSON.parse(body);
      } catch (error) {
        jsonParseError = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      id: item.id,
      method: item.method,
      path: item.path,
      expectation: item.expectation,
      realBackend: item.realBackend,
      status: response.status,
      contentType,
      body,
      bodySummary: summarize(body),
      json: json === null ? null : JSON.parse(redactSensitive(JSON.stringify(json))),
      jsonParseError,
      networkError: null,
    };
  } catch (error) {
    return {
      id: item.id,
      method: item.method,
      path: item.path,
      expectation: item.expectation,
      realBackend: item.realBackend,
      status: 0,
      contentType: '',
      body: '',
      bodySummary: '',
      json: null,
      jsonParseError: null,
      networkError: formatError(error),
    };
  } finally {
    clearTimeout(timeout);
  }
};

const evaluate = (result) => {
  if (result.networkError) {
    return { ok: false, conclusion: `NETWORK_ERROR: ${result.networkError}` };
  }

  const html = hasHtml(result.contentType, result.body);
  const json = hasJson(result.contentType, result.json);
  const upstreamFailure = [502, 503, 504].includes(result.status);

  if (html && result.path.startsWith('/api/')) {
    return { ok: false, conclusion: `FAIL_API_HTML_STATUS_${result.status}` };
  }

  if (upstreamFailure && result.realBackend) {
    return { ok: false, conclusion: `FAIL_GATEWAY_UPSTREAM_STATUS_${result.status}` };
  }

  switch (result.expectation) {
    case 'frontend-html':
      return {
        ok: result.status === 200 && htmlRootPattern.test(result.body),
        conclusion: result.status === 200 && htmlRootPattern.test(result.body) ? 'PASS_FRONTEND_HTML' : 'FAIL_FRONTEND_HTML',
      };
    case 'gateway-json-200':
      return {
        ok: result.status === 200 && json,
        conclusion: result.status === 200 && json ? 'PASS_GATEWAY_JSON' : `FAIL_GATEWAY_JSON_STATUS_${result.status}`,
      };
    case 'real-backend-health':
      return {
        ok: !html && result.status >= 200 && result.status < 500,
        conclusion:
          result.status === 200
            ? 'PASS_REAL_BACKEND_HEALTH'
            : `NON_HTML_HEALTH_REVIEW_REQUIRED_STATUS_${result.status}`,
      };
    case 'real-backend-explicit':
      return {
        ok: !html && acceptableExplicitStatuses.has(result.status),
        conclusion: !html && acceptableExplicitStatuses.has(result.status) ? `PASS_EXPLICIT_STATUS_${result.status}` : `FAIL_STATUS_${result.status}`,
      };
    case 'm4-import-json':
      return {
        ok: !html && json && [200, 201, 202, 409].includes(result.status),
        conclusion:
          !html && json && [200, 201, 202, 409].includes(result.status)
            ? `PASS_M4_IMPORT_STATUS_${result.status}`
            : `FAIL_M4_IMPORT_STATUS_${result.status}`,
      };
    case 'aggregate-placeholder':
      return {
        ok: !html && json && [200, 501].includes(result.status),
        conclusion: !html && json && [200, 501].includes(result.status) ? `PASS_AGGREGATE_STATUS_${result.status}` : `FAIL_AGGREGATE_STATUS_${result.status}`,
      };
    case 'demo-placeholder':
      return {
        ok: !html && json && [404, 501].includes(result.status),
        conclusion: !html && json && [404, 501].includes(result.status) ? `PASS_DEMO_BOUNDARY_STATUS_${result.status}` : `FAIL_DEMO_BOUNDARY_STATUS_${result.status}`,
      };
    case 'not-configured':
      return {
        ok: !html && json && result.status === 404,
        conclusion: !html && json && result.status === 404 ? 'PASS_NOT_CONFIGURED_JSON_404' : `FAIL_NOT_CONFIGURED_STATUS_${result.status}`,
      };
    case 'csv-or-error':
      return {
        ok: !html && acceptableExplicitStatuses.has(result.status),
        conclusion: !html && acceptableExplicitStatuses.has(result.status) ? `PASS_CSV_OR_EXPLICIT_STATUS_${result.status}` : `FAIL_CSV_STATUS_${result.status}`,
      };
    default:
      return { ok: false, conclusion: `UNKNOWN_EXPECTATION_${result.expectation}` };
  }
};

await mkdir(path.join(evidenceDir, 'responses'), { recursive: true });

console.log(`Real E2E smoke base URL: ${baseUrl}`);
console.log(`Evidence directory: ${evidenceDir}`);

const results = [];
for (const [index, item] of requests.entries()) {
  const raw = await request(item);
  const bodyFile = path.join(evidenceDir, 'responses', safeFileName(index, item.id));
  const bodyText = raw.networkError ? `NETWORK_ERROR: ${raw.networkError}\n` : redactSensitive(raw.body);
  await writeFile(bodyFile, bodyText, 'utf8');

  const evaluated = evaluate(raw);
  const record = {
    ...raw,
    ok: evaluated.ok,
    conclusion: evaluated.conclusion,
    bodyFile: path.relative(process.cwd(), bodyFile),
  };
  delete record.body;
  results.push(record);
  console.log(`${record.ok ? 'PASS' : 'FAIL'} ${item.method} ${item.path} -> ${record.status} ${record.contentType} ${record.conclusion}`);
}

const jsonFile = path.join(evidenceDir, 'real-e2e-smoke-results.json');
await writeFile(
  jsonFile,
  JSON.stringify(
    {
      baseUrl,
      timeoutMs,
      generatedAt: new Date().toISOString(),
      results,
    },
    null,
    2,
  ),
  'utf8',
);

const markdownRows = results.map(
  (result) =>
    `| ${markdownCell(`${result.method} ${result.path}`)} | ${result.status} | ${markdownCell(result.contentType)} | ${markdownCell(
      result.bodySummary || result.networkError || '',
    )} | ${result.realBackend ? 'yes' : 'no'} | ${result.ok ? 'pass' : 'fail'}: ${markdownCell(result.conclusion)} |`,
);
const markdown = [
  '# Real E2E Smoke Summary',
  '',
  `Base URL: \`${baseUrl}\``,
  '',
  '| Request | Status | Content-Type | Body summary | Real backend | Conclusion |',
  '|---|---:|---|---|---|---|',
  ...markdownRows,
  '',
].join('\n');
await writeFile(path.join(evidenceDir, 'real-e2e-smoke-summary.md'), markdown, 'utf8');

const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  console.error(`Real E2E smoke failed: ${failed.length}/${results.length} checks failed. See ${jsonFile}`);
  process.exitCode = 1;
} else {
  console.log(`Real E2E smoke passed: ${results.length}/${results.length} checks passed. See ${jsonFile}`);
}
