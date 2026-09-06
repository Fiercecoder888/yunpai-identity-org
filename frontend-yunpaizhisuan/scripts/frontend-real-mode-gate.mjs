#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

const readOptionalText = async (relativePath) => {
  try {
    return { exists: true, text: await readFile(path.join(root, relativePath), 'utf8') };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { exists: false, text: '' };
    }
    throw error;
  }
};

const collectSourceFiles = async (relativeDir) => {
  const absoluteDir = path.join(root, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const childRelative = `${relativeDir.replace(/\\/g, '/')}/${entry.name}`;
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'coverage', 'test-results', 'playwright-report'].includes(entry.name)) {
        continue;
      }
      files.push(...(await collectSourceFiles(childRelative)));
      continue;
    }

    if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(childRelative);
    }
  }

  return files;
};

const checks = [];
const record = (status, name, details = '') => {
  checks.push({ status, name, details });
};
const pass = (name, details = '') => record('PASS', name, details);
const fail = (name, details = '') => record('FAIL', name, details);
const skip = (name, details = '') => record('SKIP', name, details);
const check = (name, passed, details = '') => (passed ? pass(name, details) : fail(name, details));

const sourceFiles = await collectSourceFiles('src');
const searchableFiles = [
  ...sourceFiles,
  'package.json',
  'docker-compose.package.yml',
  'Dockerfile',
  'nginx.conf',
  'nginx.real-e2e.conf',
  'scripts/docker-api-smoke.mjs',
  'scripts/real-e2e-smoke.mjs',
  'scripts/frontend-real-mode-gate.mjs',
  'src/mocks/fixtures/dashboard.json',
  'src/mocks/fixtures/agentFlow.json',
  'src/pages/LegalFinalReviewPage.tsx',
  'src/layouts/SideNav.tsx',
  'src/schemas/m5.ts',
  'docs/ENTERPRISE_ASSISTANT_CHAT_STREAM.md',
];

const fileTexts = new Map();
for (const file of searchableFiles) {
  const result = await readOptionalText(file);
  if (result.exists) {
    fileTexts.set(file, result.text);
  }
}

const requiredFrontendFiles = [
  'src/services/apiGateway.ts',
  'src/services/permissionApi.ts',
  'src/services/httpClient.ts',
  'src/services/apiContractManifest.ts',
  'src/services/apiContractMatrix.test.ts',
  'src/services/legalApi.ts',
  'src/pages/DashboardPage.tsx',
];
for (const file of requiredFrontendFiles) {
  check(`Frontend package includes ${file}`, fileTexts.has(file));
}

const forbiddenBaseUrlPattern = /VITE_(?:M[1-8]|ORCHESTRATOR|MODULE|DASHBOARD|TASK|BOM|SOP|PURCHASE|LEGAL)[A-Z0-9_]*API_BASE_URL/g;
const forbiddenMatches = [];
for (const [file, text] of fileTexts) {
  for (const match of text.matchAll(forbiddenBaseUrlPattern)) {
    forbiddenMatches.push(`${file}:${match[0]}`);
  }
}
check(
  'No module-specific Vite API base URLs',
  forbiddenMatches.length === 0,
  forbiddenMatches.length === 0 ? 'Only VITE_API_BASE_URL is allowed for frontend API base configuration.' : forbiddenMatches.join(', '),
);

const apiGateway = fileTexts.get('src/services/apiGateway.ts') ?? '';
check('Unified helper defaults to /api', apiGateway.includes("return trimmed && trimmed.length > 0 ? trimmed : '/api';"));
check('Unified helper strips leading /api once', apiGateway.includes("trimmed.replace(/^\\/api(?=\\/|$)/, '')"));
check('Unified helper blocks legacy /api/v1 and /api/modules paths', apiGateway.includes("'/api/v1/'") && apiGateway.includes("'/api/modules/'"));

const permissionApi = fileTexts.get('src/services/permissionApi.ts') ?? '';
check('Permission API has no top-level mock fixture import', !/^import\s+.*(?:mocks|fixtures)/m.test(permissionApi));
check('Permission API loads demo fixture only through dynamic import', permissionApi.includes("import('../mocks/fixtures/permissions.json')"));
check('Permission API calls the real auth endpoint in real mode', permissionApi.includes("requestJson<unknown>('/auth/me')"));
check('Permission API uses a unified /api helper through httpClient', permissionApi.includes("from './httpClient'"));

const permissionGate = fileTexts.get('src/components/PermissionGate.tsx') ?? '';
check('PermissionGate supports async permission loading', permissionGate.includes('useQuery') && permissionGate.includes('roleQuery.isLoading'));
check('PermissionGate fails closed when permission backend is unavailable', permissionGate.includes('权限后端未就绪') && permissionGate.includes('fail closed'));
check('PermissionGate audits permission denial', permissionGate.includes('PERMISSION_DENIED') && permissionGate.includes('writeAuditLogSafely'));

const purchasePage = fileTexts.get('src/pages/PurchaseWarningsPage.tsx') ?? '';
check('M4 page uses the shared async permission source', purchasePage.includes('currentRoleQueryKey') && purchasePage.includes('getCurrentRole'));
check('M4 page disables operations when real permissions are unavailable', purchasePage.includes('M4 写操作已按 fail closed 禁用'));

const httpClient = fileTexts.get('src/services/httpClient.ts') ?? '';
check(
  'httpClient timeout classification depends on the internal timeout flag',
  httpClient.includes('InternalTimeoutError') && httpClient.includes('Promise.race') && httpClient.includes("code: 'timeout'"),
);
check('httpClient keeps network errors distinct from timeout', httpClient.includes("code: 'network_error'"));
check('httpClient keeps parse errors distinct', httpClient.includes("code: 'parse_error'"));

const dashboard = fileTexts.get('src/pages/DashboardPage.tsx') ?? '';
for (const [moduleId, route] of [
  ['m1', '/modules/m0-review'],
  ['m2', '/modules/bom-review'],
  ['m4', '/modules/purchase-warnings'],
  ['m5', '/modules/m5-flow'],
  ['m7', '/modules/legal-final-review'],
]) {
  check(`Dashboard route maps ${moduleId} to ${route}`, dashboard.includes(`${moduleId}: '${route}'`));
}
check('Dashboard leaves unmapped modules read-only', dashboard.includes("role={route ? 'link' : undefined}") && dashboard.includes('tabIndex={route ? 0 : undefined}'));

const realNginx = fileTexts.get('nginx.real-e2e.conf');
if (realNginx) {
  check('Frontend real nginx proxies /api to api-gateway', /location\s+\/api\/[\s\S]*proxy_pass\s+http:\/\/api-gateway:8080;/.test(realNginx));
  check('Frontend real nginx keeps SPA fallback outside /api', /location\s+\/\s+\{[\s\S]*try_files\s+\$uri\s+\$uri\/\s+\/index\.html;/.test(realNginx));
} else {
  skip('Frontend real nginx proxy check', 'nginx.real-e2e.conf is not part of this frontend source package.');
}

const manifest = fileTexts.get('src/services/apiContractManifest.ts') ?? '';
check('API contract manifest registers the auth permission endpoint', manifest.includes("id: 'gateway.auth.me'") && manifest.includes("pathPattern: '/api/auth/me'"));
check('API contract manifest marks auth endpoint as needs backend confirmation', manifest.includes("realBackendStatus: 'needs_backend_confirmation'"));
check('API contract manifest marks demo routes as demo_only', manifest.includes("realBackendStatus: 'demo_only'"));
check('API contract manifest marks M7/legal as not_implemented', manifest.includes("id: 'demo.legal.risks.list'") && manifest.includes("realBackendStatus: 'not_implemented'"));
check('API contract manifest has no /api/v1 frontend path patterns', !/pathPattern:\s*['"]\/api\/v1\//.test(manifest));

const contractTest = fileTexts.get('src/services/apiContractMatrix.test.ts') ?? '';
check('API contract matrix checks every service export is registered or ignored', contractTest.includes('registers or explicitly ignores every runtime service function export'));
check('API contract matrix covers the auth permission endpoint', contractTest.includes("'gateway.auth.me'"));
check('API contract matrix tests M7/legal real-mode rejection', contractTest.includes('treats demo-only legal services as not implemented in real backend mode'));

const legalApi = fileTexts.get('src/services/legalApi.ts') ?? '';
check('Legal API rejects M7 in real backend mode', legalApi.includes('!isMswDemoMode()') && legalApi.includes("code: 'not_implemented'") && legalApi.includes("module: 'M7'"));
check('Legal API only uses demo legal runtime paths', [...legalApi.matchAll(/requestJson<[^>]+>\(`?([^'`]+)[`']?/g)].every((match) => match[1].startsWith('/demo/legal/')));
check('Legal API has no M5, schedule, or orchestrator dependency', !/from\s+['"].*(?:m5Api|scheduleApi|orchestratorApi)['"]/.test(legalApi));

const legalPage = fileTexts.get('src/pages/LegalFinalReviewPage.tsx') ?? '';
check('Legal page uses the shared runtime mode source', legalPage.includes('isMswDemoMode()'));
check('Legal Demo query uses an isolated namespace', legalPage.includes("['demo', 'legal-risks']") && legalPage.includes('exact: true'));
check('Legal real mode renders without mounting the Demo query component', legalPage.includes('isMswDemoMode() ? <DemoLegalFinalReviewPage /> : <RealLegalBoundary />'));
check('Legal Demo audit is explicitly isolated', ['demo-legal-reviewer', 'DEMO_LEGAL_FINAL_REVIEW_RECORDED', 'LegalDemo', '[DEMO]'].every((value) => legalPage.includes(value)));

const runtimeServiceFiles = sourceFiles.filter((file) => file.startsWith('src/services/') && !/\.test\.[^.]+$/.test(file));
const forbiddenRuntimeCalls = runtimeServiceFiles.flatMap((file) => {
  const text = fileTexts.get(file) ?? '';
  return [...text.matchAll(/['"`]\/(?:api\/)?(?:m7|legal)\//gi)].map((match) => `${file}:${match[0]}`);
});
check('Runtime services contain no real /api/m7 or /api/legal calls', forbiddenRuntimeCalls.length === 0, forbiddenRuntimeCalls.join(', '));

const m5Schema = fileTexts.get('src/schemas/m5.ts') ?? '';
check('M5 frontend schema contains no Legal or M7 status fields', !/(?:legal|m7)[A-Za-z0-9_]*(?:status)?\s*:/i.test(m5Schema));

const dashboardFixture = fileTexts.get('src/mocks/fixtures/dashboard.json') ?? '';
check('Dashboard runtime fixture has no M7 legal activity', !/M7|法务|终审/i.test(dashboardFixture));

const flowFixture = JSON.parse(fileTexts.get('src/mocks/fixtures/agentFlow.json') ?? '{"nodes":[],"edges":[]}');
const flowModules = new Map(flowFixture.nodes.map((node) => [node.id, String(node.module).toLowerCase()]));
const hasM5M7Edge = flowFixture.edges.some((edge) => {
  const pair = [flowModules.get(edge.source), flowModules.get(edge.target)].sort().join('-');
  return pair === 'm5-m7';
});
check('Runtime flow fixture contains no M5/M7 edge', !hasM5M7Edge);

const packageJson = fileTexts.get('package.json') ?? '';
check('Package exposes a source-package real-mode gate', packageJson.includes('"test:real-mode-gate"'));
check('Package separates full topology gate from package self-check', packageJson.includes('"test:real-e2e-topology-gate"'));
check('Package exposes build metadata and release provenance gates', packageJson.includes('"test:build-metadata"') && packageJson.includes('"test:release-provenance"'));

const dockerfile = fileTexts.get('Dockerfile') ?? '';
check('Dockerfile defaults to the package gateway nginx config', dockerfile.includes('ARG NGINX_CONF=nginx.real-e2e.conf'));
check('Dockerfile applies matching OCI and Yunpai provenance labels', ['org.opencontainers.image.revision', 'org.opencontainers.image.created', 'com.yunpai.source.branch', 'com.yunpai.source.dirty'].every((label) => dockerfile.includes(label)));

const packageCompose = fileTexts.get('docker-compose.package.yml') ?? '';
check('Package compose includes frontend and api-gateway services', /^\s{2}frontend:/m.test(packageCompose) && /^\s{2}api-gateway:/m.test(packageCompose));
check('Package compose uses full gateway config without backend archive', packageCompose.includes('context: ./api-gateway') && !packageCompose.includes('Yunpai_Project-20260709-Archive'));

const chatStreamDoc = fileTexts.get('docs/ENTERPRISE_ASSISTANT_CHAT_STREAM.md') ?? '';
check('Frontend package includes the enterprise assistant chat stream document', chatStreamDoc.length > 0);
check('Chat stream document has no Reserved protocol wording', !/\bReserved\b/.test(chatStreamDoc));
check(
  'Chat stream document identifies implemented backend-emitted tool events',
  /Implemented backend-emitted tool events:/.test(chatStreamDoc),
);
check(
  'Chat stream document attributes tool events to the server allowlist and ToolRegistry',
  chatStreamDoc.includes('ChatService') && /server-allowlisted/.test(chatStreamDoc) && chatStreamDoc.includes('ToolRegistry'),
);

for (const item of checks) {
  console.log(`${item.status} ${item.name}${item.details ? ` - ${item.details}` : ''}`);
}

const failed = checks.filter((item) => item.status === 'FAIL');
if (failed.length > 0) {
  console.error(`Frontend real-mode gate failed: ${failed.length}/${checks.length} checks failed.`);
  process.exitCode = 1;
} else {
  console.log(`Frontend real-mode gate completed: ${checks.length}/${checks.length} checks had no FAIL status.`);
}
