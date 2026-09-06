#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const checks = [];
const record = (status, name, details = '') => checks.push({ status, name, details });
const pass = (name, details = '') => record('PASS', name, details);
const fail = (name, details = '') => record('FAIL', name, details);
const blocked = (name, details = '') => record('BLOCKED', name, details);
const check = (name, passed, details = '') => (passed ? pass(name, details) : fail(name, details));

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

const sourceRuntimeComposeFile = process.env.FRONTEND_REAL_E2E_COMPOSE || '../deploy/source-runtime/compose.yml';
const sourceRuntimeFragmentsFile = '../deploy/source-runtime/compose-files.list';
const frontendRuntimeFragmentFile = 'deploy/compose.runtime.yml';
const gatewayFile = 'api-gateway/nginx.conf';
const nginxRealE2eFile = 'nginx.real-e2e.conf';
const packageComposeFile = 'docker-compose.package.yml';

const sourceRuntimeCompose = await readOptionalText(sourceRuntimeComposeFile);
const sourceRuntimeFragments = await readOptionalText(sourceRuntimeFragmentsFile);
const frontendRuntimeFragment = await readOptionalText(frontendRuntimeFragmentFile);
const gateway = await readOptionalText(gatewayFile);
const nginxRealE2e = await readOptionalText(nginxRealE2eFile);
const packageCompose = await readOptionalText(packageComposeFile);

const truthBlocked = [];
for (const [name, result, pathLabel] of [
  ['source-runtime topology compose', sourceRuntimeCompose, sourceRuntimeComposeFile],
  ['source-runtime fragment manifest', sourceRuntimeFragments, sourceRuntimeFragmentsFile],
]) {
  if (result.exists) {
    pass(`Topology truth found: ${name}`, pathLabel);
  } else {
    blocked(`Topology truth missing: ${name}`, `Expected ${pathLabel}; run this gate from the complete repository workspace or set FRONTEND_REAL_E2E_COMPOSE.`);
    truthBlocked.push(name);
  }
}

if (sourceRuntimeCompose.exists) {
  const compose = sourceRuntimeCompose.text;
  check('Source-runtime compose includes frontend service', /^\s{2}frontend:/m.test(compose));
  check('Source-runtime compose includes api-gateway service', /^\s{2}api-gateway:/m.test(compose));
  check('Source-runtime compose frontend mounts the real nginx config', /frontend\/nginx\.real-e2e\.conf:\/etc\/nginx\/conf\.d\/default\.conf:ro/.test(compose));
  check('Source-runtime compose frontend mounts dist read-only', /frontend\/dist:\/usr\/share\/nginx\/html:ro/.test(compose));
  check('Source-runtime compose api-gateway mounts frontend nginx config', /frontend\/api-gateway\/nginx\.conf/.test(compose));
  const expectedFrontendPortDefault = process.env.FRONTEND_PORT_DEFAULT ?? '8000';
  check('Source-runtime compose frontend keeps the default release port', compose.includes(`\${FRONTEND_PORT:-${expectedFrontendPortDefault}}:80`));
  check('Source-runtime compose keeps API keys as env placeholders', compose.includes('ORCH_LLM_API_KEY: "${ORCH_LLM_API_KEY:-}"') && !/sk-[A-Za-z0-9_-]{12,}/i.test(compose));
  check('Source-runtime compose defines no M7/legal service', !/^\s{2}(m7|legal):/m.test(compose));
}

if (sourceRuntimeFragments.exists) {
  check('Source-runtime fragment manifest registers frontend runtime fragment', sourceRuntimeFragments.text.includes('frontend/deploy/compose.runtime.yml'));
}

if (frontendRuntimeFragment.exists) {
  const fragment = frontendRuntimeFragment.text;
  check('Frontend runtime fragment includes frontend service', /^\s{2}frontend:/m.test(fragment));
  check('Frontend runtime fragment includes api-gateway service', /^\s{2}api-gateway:/m.test(fragment));
  check('Frontend runtime fragment requires FRONTEND_IMAGE', fragment.includes('${FRONTEND_IMAGE:?FRONTEND_IMAGE is required}'));
  check('Frontend runtime fragment requires API_GATEWAY_IMAGE', fragment.includes('${API_GATEWAY_IMAGE:?API_GATEWAY_IMAGE is required}'));
  check('Frontend runtime fragment mounts the real nginx config and dist', /frontend\/nginx\.real-e2e\.conf:\/etc\/nginx\/conf\.d\/default\.conf:ro/.test(fragment) && /frontend\/dist:\/usr\/share\/nginx\/html:ro/.test(fragment));
  check('Frontend runtime fragment api-gateway mounts frontend nginx config', /frontend\/api-gateway\/nginx\.conf/.test(fragment));
  check('Frontend runtime fragment defines no M7/legal service', !/^\s{2}(m7|legal):/m.test(fragment));
} else {
  blocked(`Module runtime fragment missing: frontend/${frontendRuntimeFragmentFile}`, 'frontend/deploy/compose.runtime.yml is the module-owned production runtime contract.');
}

if (gateway.exists) {
  const gatewayText = gateway.text;
  check('Gateway returns JSON for unconfigured /api routes', gatewayText.includes('API route is not configured in the gateway'));
  check('Gateway returns JSON for demo-only routes in real mode', gatewayText.includes('Demo-only endpoint is not implemented in real mode'));
  const demoLegalLocation = gatewayText.match(/location\s+~\s+\^\/api\/demo\/[^\n]+\{[\s\S]*?(?=\n\s*location\s|\n\})/)?.[0] ?? '';
  check('Gateway demo legal location remains JSON 501 without proxy_pass', demoLegalLocation.includes('return 501') && demoLegalLocation.includes('application/json') && !demoLegalLocation.includes('proxy_pass'));
  check('Gateway config defines no M7/legal upstream', !/set\s+\$upstream_(?:m7|legal)\b/i.test(gatewayText));
  check('Gateway routes M3/M4/M5/M6 health to baseline /health', ['m3', 'm4', 'm5', 'm6'].every((module) => gatewayText.includes(`location = /api/${module}/health`)));
} else {
  blocked(`Gateway nginx config missing: ${gatewayFile}`, 'frontend/api-gateway/nginx.conf is required for the real topology.');
}

if (nginxRealE2e.exists) {
  check('Frontend real nginx proxies /api to api-gateway', /location\s+\/api\/[\s\S]*proxy_pass\s+http:\/\/api-gateway:8080;/.test(nginxRealE2e.text));
  check('Frontend real nginx keeps SPA fallback outside /api', /location\s+\/\s+\{[\s\S]*try_files\s+\$uri\s+\$uri\/\s+\/index\.html;/.test(nginxRealE2e.text));
} else {
  blocked(`Frontend real nginx config missing: ${nginxRealE2eFile}`, 'nginx.real-e2e.conf is required for the real topology.');
}

if (packageCompose.exists) {
  check('Package compose defines no M7/legal service', !/^\s{2}(m7|legal):/m.test(packageCompose.text));
}

for (const item of checks) {
  console.log(`${item.status} ${item.name}${item.details ? ` - ${item.details}` : ''}`);
}

const failed = checks.filter((item) => item.status === 'FAIL');
const blockedCount = checks.filter((item) => item.status === 'BLOCKED');
if (failed.length > 0) {
  console.error(`Frontend real E2E topology gate failed: ${failed.length}/${checks.length} checks failed.`);
  process.exitCode = 1;
} else if (blockedCount.length > 0) {
  console.log(`Frontend real E2E topology gate blocked: ${blockedCount.length} required topology files are missing.`);
  process.exitCode = 2;
} else {
  console.log(`Frontend real E2E topology gate passed: ${checks.length}/${checks.length} checks passed.`);
}
