#!/usr/bin/env node

const baseUrl = (process.env.DOCKER_API_BASE_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
const timeoutMs = Number(process.env.DOCKER_API_TIMEOUT_MS ?? 5000);

const frontendRoutes = [
  '/',
  '/dashboard',
  '/tasks',
  '/modules/m0-review',
  '/modules/bom-review',
  '/modules/sop',
  '/modules/purchase-warnings',
  '/modules/schedule',
  '/modules/legal-final-review',
  '/audit',
  '/not-a-real-route',
];

const apiBoundaryRequests = [
  { method: 'GET', path: '/api/gateway/health', statuses: [200], json: true, label: 'gateway health' },
  { method: 'GET', path: '/api/gateway/routes', statuses: [200], json: true, label: 'gateway route table' },
  { method: 'GET', path: '/api/not-configured', statuses: [404], json: true, label: 'unknown API JSON boundary' },
  { method: 'GET', path: '/api/demo/legal/risks', statuses: [404, 501], json: true, label: 'demo-only legal boundary' },
  { method: 'GET', path: '/api/m7/unknown', statuses: [404], json: true, label: 'M7 is not a configured service' },
  { method: 'GET', path: '/api/legal/unknown', statuses: [404], json: true, label: 'Legal is not a configured service' },
];

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
      signal: controller.signal,
    });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timeout);
  }
};

const hasRootElement = (html) => html.includes('id="root"');
const isHtml = (response, text) =>
  (response.headers.get('content-type') ?? '').includes('text/html') || hasRootElement(text) || /^\s*<!doctype html/i.test(text);
const isJson = (response) => (response.headers.get('content-type') ?? '').includes('application/json');
const assetPattern = /(?:src|href)="([^"]*\/assets\/[^"]+)"/g;

console.log(`Docker API smoke base URL: ${baseUrl}`);

const root = await request('/');
assert(root.response.status === 200, `GET / expected 200, got ${root.response.status}`);
assert(hasRootElement(root.text), 'GET / did not return the frontend HTML root element');

const assetPaths = [...root.text.matchAll(assetPattern)].map((match) => match[1]);
assert(assetPaths.length > 0, 'GET / did not expose any built /assets/ references');

for (const route of frontendRoutes) {
  const { response, text } = route === '/' ? root : await request(route);
  assert(response.status === 200, `GET ${route} expected 200, got ${response.status}`);
  assert(hasRootElement(text), `GET ${route} did not return frontend HTML`);
  console.log(`route ${route} -> ${response.status}`);
}

for (const assetPath of assetPaths) {
  const { response, text } = await request(assetPath);
  assert(response.status === 200, `GET ${assetPath} expected 200, got ${response.status}`);
  assert(text.length > 0, `GET ${assetPath} returned an empty asset`);
  console.log(`asset ${assetPath} -> ${response.status}`);
}

assert(!root.text.includes('mockServiceWorker.js'), 'index.html directly references mockServiceWorker.js');

for (const { method, path, statuses, json, label } of apiBoundaryRequests) {
  const init =
    method === 'GET'
      ? { method }
      : {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ smoke: true }),
        };
  const { response, text } = await request(path, init);

  assert(statuses.includes(response.status), `${method} ${path} expected ${statuses.join('/')} for ${label}, got ${response.status}`);
  assert(!isHtml(response, text), `${method} ${path} fell back to frontend HTML`);
  if (json) {
    assert(isJson(response), `${method} ${path} expected application/json, got ${response.headers.get('content-type') ?? ''}`);
    JSON.parse(text);
  }
  console.log(`api ${method} ${path} -> ${response.status}`);
}

console.log(`Docker API smoke passed: ${frontendRoutes.length} routes, ${assetPaths.length} assets, ${apiBoundaryRequests.length} API boundaries`);
