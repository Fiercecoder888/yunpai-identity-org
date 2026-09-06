#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PNPM = 'corepack pnpm@10.14.0';

export const VERIFY_STEPS = [
  { name: 'typecheck', script: 'typecheck' },
  { name: 'lint', script: 'lint' },
  { name: 'vitest', script: 'test' },
  { name: 'real-mode-gate', script: 'test:real-mode-gate' },
  { name: 'build-metadata', script: 'test:build-metadata' },
  { name: 'release-provenance', script: 'test:release-provenance' },
];

export const defaultPnpmCommand = () => (process.env.YUNPAI_VERIFY_PNPM ?? DEFAULT_PNPM).split(/\s+/);

export function runVerifySteps({ cwd = process.cwd(), pnpm = defaultPnpmCommand() } = {}) {
  const results = [];
  let ok = true;

  for (const step of VERIFY_STEPS) {
    const startedAt = new Date().toISOString();
    const command = [...pnpm, 'run', step.script].join(' ');
    const spawned = spawnSync(command, {
      cwd,
      stdio: 'inherit',
      shell: true,
    });
    const finishedAt = new Date().toISOString();
    const exitCode = spawned.error ? -1 : (spawned.status ?? -1);
    const status = exitCode === 0 ? 'passed' : exitCode === -1 ? 'spawn_error' : 'failed';
    results.push({ name: step.name, script: step.script, status, exitCode, startedAt, finishedAt });
    if (status !== 'passed') ok = false;
  }

  return { ok, results };
}

export const writeVerifyReport = ({ ok, results }, cwd = process.cwd()) => {
  const reportDir = resolve(cwd, 'scripts/test-outcomes');
  mkdirSync(reportDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const report = {
    ok,
    generatedAt: new Date().toISOString(),
    steps: results,
    failedSteps: results.filter((result) => result.status !== 'passed').map((result) => result.name),
  };
  writeFileSync(resolve(reportDir, `verify-${timestamp}.json`), `${JSON.stringify(report, null, 2)}\n`);
  return report;
};

const isMain = () => process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain()) {
  const report = runVerifySteps();
  writeVerifyReport(report);
  console.log('verify summary:');
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}
