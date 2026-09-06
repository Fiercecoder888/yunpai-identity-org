#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BUILD_BRANCH_META_NAME,
  BUILD_COMMIT_META_NAME,
  BUILD_DIRTY_META_NAME,
  BUILD_TIME_META_NAME,
  assertReleaseMetadata,
} from './build-metadata.mjs';

const root = process.cwd();
const metadataPath = path.resolve(root, process.env.FRONTEND_BUILD_INFO ?? 'dist/build-info.json');
const indexPath = path.resolve(root, process.env.FRONTEND_INDEX_HTML ?? 'dist/index.html');
const run = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sourceCommit = run('git', ['rev-parse', 'HEAD']);
const sourceBranch = run('git', ['branch', '--show-current']);
const [metadataJson, indexHtml] = await Promise.all([readFile(metadataPath, 'utf8'), readFile(indexPath, 'utf8')]);
const metadata = assertReleaseMetadata(JSON.parse(metadataJson));

if (metadata.commit !== sourceCommit) throw new Error(`build-info commit ${metadata.commit} does not match source HEAD ${sourceCommit}`);
if (metadata.branch !== sourceBranch) throw new Error(`build-info branch ${metadata.branch} does not match source branch ${sourceBranch}`);

const buildCommitMeta = indexHtml.match(new RegExp(`<meta\\b[^>]*\\bname=["']${BUILD_COMMIT_META_NAME}["'][^>]*>`, 'i'))?.[0];
if (!buildCommitMeta?.includes(`content="${metadata.commit}"`)) {
  throw new Error(`index.html ${BUILD_COMMIT_META_NAME} does not match build-info commit ${metadata.commit}`);
}

const expectedMeta = [
  [BUILD_COMMIT_META_NAME, metadata.commit],
  [BUILD_BRANCH_META_NAME, metadata.branch],
  [BUILD_TIME_META_NAME, metadata.buildTime],
  [BUILD_DIRTY_META_NAME, String(metadata.dirty)],
];
for (const [metaName, value] of expectedMeta) {
  const metaTag = indexHtml.match(new RegExp(`<meta\\b[^>]*\\bname=["']${metaName}["'][^>]*>`, 'i'))?.[0];
  if (!metaTag?.includes(`content="${value}"`)) {
    throw new Error(`index.html ${metaName} does not match build-info ${metaName} ${value}`);
  }
}

console.log(`source HEAD: ${sourceCommit}`);
console.log(`source branch: ${sourceBranch}`);
console.log(`build-info: ${JSON.stringify(metadata)}`);
console.log(`index metadata: ${expectedMeta.map(([name, value]) => `${name}="${value}"`).join(' ')}`);

const image = process.env.FRONTEND_IMAGE;
if (image) {
  const labels = JSON.parse(run('docker', ['image', 'inspect', image, '--format', '{{json .Config.Labels}}']));
  const expected = {
    'org.opencontainers.image.revision': metadata.commit,
    'org.opencontainers.image.created': metadata.buildTime,
    'com.yunpai.source.branch': metadata.branch,
    'com.yunpai.source.dirty': String(metadata.dirty),
  };
  for (const [key, value] of Object.entries(expected)) {
    if (labels?.[key] !== value) throw new Error(`Image label ${key}=${labels?.[key]} does not match build-info value ${value}`);
  }
  console.log(`image labels (${image}): ${JSON.stringify(labels)}`);
}

console.log(`Frontend provenance gate passed for ${image ? 'Docker image and static dist' : 'bind-mounted static dist'}.`);
