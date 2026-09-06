#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  BUILD_BRANCH_META_NAME,
  BUILD_COMMIT_META_NAME,
  BUILD_DIRTY_META_NAME,
  BUILD_TIME_META_NAME,
  assertReleaseMetadata,
} from './build-metadata.mjs';
import { runVerifySteps, writeVerifyReport } from './verify.mjs';

const root = process.cwd();
const checks = [];
const record = (status, name, details = '') => checks.push({ status, name, details });
const pass = (name, details = '') => record('PASS', name, details);
const fail = (name, details = '') => record('FAIL', name, details);

const runStepChecks = ({ results }) => {
  for (const step of results) {
    if (step.status === 'passed') {
      pass(`verify step ${step.name}`, `${step.script} exited 0`);
    } else {
      fail(`verify step ${step.name}`, `${step.script} ${step.status} (exit ${step.exitCode})`);
    }
  }
};

const evidenceChecks = async () => {
  const metadataPath = resolve(root, process.env.FRONTEND_BUILD_INFO ?? 'dist/build-info.json');
  const indexPath = resolve(root, process.env.FRONTEND_INDEX_HTML ?? 'dist/index.html');

  let metadataText = null;
  try {
    metadataText = await readFile(metadataPath, 'utf8');
  } catch {
    metadataText = null;
  }

  if (metadataText === null) {
    fail('dist/build-info.json exists', 'required release evidence is missing');
    return;
  }

  let metadata;
  try {
    metadata = assertReleaseMetadata(JSON.parse(metadataText));
    pass('dist/build-info.json validates', `commit=${metadata.commit} dirty=${metadata.dirty}`);
  } catch (error) {
    fail('dist/build-info.json validates', error.message);
    return;
  }

  let indexHtml = null;
  try {
    indexHtml = await readFile(indexPath, 'utf8');
  } catch {
    indexHtml = null;
  }

  if (indexHtml === null) {
    fail('dist/index.html exists', 'required release evidence is missing');
    return;
  }

  const expectedMeta = [
    [BUILD_COMMIT_META_NAME, metadata.commit],
    [BUILD_BRANCH_META_NAME, metadata.branch],
    [BUILD_TIME_META_NAME, metadata.buildTime],
    [BUILD_DIRTY_META_NAME, String(metadata.dirty)],
  ];
  for (const [metaName, value] of expectedMeta) {
    const metaTag = indexHtml.match(new RegExp(`<meta\\b[^>]*\\bname=["']${metaName}["'][^>]*>`, 'i'))?.[0];
    if (metaTag?.includes(`content="${value}"`)) {
      pass(`HTML meta matches build-info ${metaName}`, metaTag);
    } else {
      fail(`HTML meta matches build-info ${metaName}`, `expected content="${value}" in ${metaName}`);
    }
  }
};

const run = async () => {
  const verifyReport = runVerifySteps({ cwd: root });
  runStepChecks(verifyReport);

  await evidenceChecks();

  for (const item of checks) {
    console.log(`${item.status} ${item.name}${item.details ? ` - ${item.details}` : ''}`);
  }

  const failed = checks.filter((item) => item.status === 'FAIL');
  const summary = {
    ok: failed.length === 0 && verifyReport.ok,
    generatedAt: new Date().toISOString(),
    checks,
    failedChecks: failed.map((item) => item.name),
    failedVerifySteps: verifyReport.results.filter((result) => result.status !== 'passed').map((result) => result.name),
  };
  writeVerifyReport(verifyReport, root);
  console.log('p0-quality-gate summary:');
  console.log(JSON.stringify(summary, null, 2));

  if (summary.ok) {
    console.log(`P0 release quality gate passed: ${checks.length}/${checks.length} checks had no FAIL status.`);
    process.exitCode = 0;
  } else {
    console.error(`P0 release quality gate failed: ${failed.length}/${checks.length} checks failed. No allow_failure is permitted.`);
    process.exitCode = 1;
  }
};

await run();
