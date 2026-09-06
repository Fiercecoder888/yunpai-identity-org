#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const ALLOW_HIGH_ENV = 'YUNPAI_AUDIT_ALLOW_HIGH';

const pnpm = (process.env.YUNPAI_AUDIT_PNPM ?? 'corepack pnpm@10.14.0').split(/\s+/);

const printReport = (report) => {
  console.log(`audit gate: ${report.status}`);
  console.log(JSON.stringify(report, null, 2));
};

const command = [...pnpm, 'audit', '--audit-level=high', '--prod', '--json'].join(' ');
const spawned = spawnSync(command, {
  encoding: 'utf8',
  shell: true,
});

if (spawned.error) {
  const report = {
    status: 'blocked',
    reason: 'spawn_error',
    message: spawned.error.message,
    vulnerabilities: null,
  };
  printReport(report);
  process.exitCode = 2;
} else {
  let audit = null;
  try {
    audit = JSON.parse(spawned.stdout || '{}');
  } catch {
    const report = {
      status: 'blocked',
      reason: 'unparseable_output',
      message: 'pnpm audit did not return JSON output (offline registry or unsupported format).',
      exitCode: spawned.status ?? -1,
      vulnerabilities: null,
    };
    printReport(report);
    process.exitCode = 2;
    process.exit();
  }

  const vulnerabilities = audit.metadata?.vulnerabilities ?? {};
  const highAndCritical = (vulnerabilities.high ?? 0) + (vulnerabilities.critical ?? 0);
  const report = {
    status: highAndCritical > 0 ? 'failed' : 'passed',
    allowHigh: process.env[ALLOW_HIGH_ENV] === '1',
    vulnerabilities,
    prodOnly: true,
    auditLevel: 'high',
    exitCode: spawned.status ?? -1,
  };

  if (highAndCritical > 0) {
    if (report.allowHigh) {
      report.status = 'passed_with_warning';
      console.warn(
        `${ALLOW_HIGH_ENV}=1 set; ${highAndCritical} high/critical production vulnerabilities are allowed for this gate.`,
      );
    }
  }

  printReport(report);
  process.exitCode = report.status === 'passed' || report.status === 'passed_with_warning' ? 0 : 1;
}
