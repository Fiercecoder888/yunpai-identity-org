#!/usr/bin/env node

import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const root = process.cwd();
const packageName = process.env.FRONTEND_SOURCE_PACKAGE_NAME ?? 'yunpaizhisuan-FE-frontend-source-20260712-fixed';
const stagingRoot = resolve(os.tmpdir(), `${packageName}-staging`);
const stagingDir = join(stagingRoot, packageName);
const output7z = resolve(root, `${packageName}.7z`);
const outputZip = resolve(root, `${packageName}.zip`);

const includeFiles = [
  '.dockerignore',
  '.env.example',
  '.gitignore',
  '.nvmrc',
  'Dockerfile',
  'README.md',
  'docker-compose.yml',
  'docker-compose.mock.yml',
  'docker-compose.package.yml',
  'eslint.config.js',
  'index.html',
  'nginx.conf',
  'nginx.real-e2e.conf',
  'package.json',
  'playwright.config.ts',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.app.json',
  'tsconfig.json',
  'tsconfig.node.json',
  'vite.config.ts',
];

const includeDirs = ['api-gateway', 'docs', 'e2e', 'public', 'scripts', 'src'];

const excludedNames = new Set([
  '.git',
  '.agents',
  '.codex',
  'node_modules',
  'dist',
  'coverage',
  'evidence',
  'playwright-report',
  'test-results',
  'Yunpai_Project-20260709-Archive',
  'archive',
]);

const excludedFilePatterns = [
  /Prompt.*\.md$/i,
  /审查.*\.md$/i,
  /报告.*\.md$/i,
  /REPORT.*\.md$/,
  /^REAL_FRONTEND_BACKEND_E2E_EVIDENCE_REPORT\.md$/,
  /^FRONTEND_PACKAGE_STATIC_FINDINGS_FIX_REPORT\.md$/,
  /\.(?:7z|zip|tar|tgz|tar\.gz)$/i,
  /\.tsbuildinfo$/i,
  /\.log$/i,
  /^feature-pages-.*\.png$/i,
];

const copied = [];
const excluded = [];

const shouldExclude = (absolutePath, direntName) => {
  if (excludedNames.has(direntName)) {
    return true;
  }
  const rel = relative(root, absolutePath).replace(/\\/g, '/');
  return excludedFilePatterns.some((pattern) => pattern.test(direntName) || pattern.test(rel));
};

const copyOneFile = async (source, target) => {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  copied.push(relative(stagingDir, target).replace(/\\/g, '/'));
};

const copyDir = async (sourceDir, targetDir) => {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const source = join(sourceDir, entry.name);
    const target = join(targetDir, entry.name);
    const rel = relative(root, source).replace(/\\/g, '/');
    if (shouldExclude(source, entry.name)) {
      excluded.push(rel);
      continue;
    }
    if (entry.isDirectory()) {
      await copyDir(source, target);
    } else if (entry.isFile()) {
      await copyOneFile(source, target);
    }
  }
};

const sha256 = async (file) =>
  new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolveHash(hash.digest('hex')));
  });

const commandExists = (command) => spawnSync(command, ['--help'], { stdio: 'ignore' }).status === 0;

await rm(stagingRoot, { recursive: true, force: true });
await rm(output7z, { force: true });
await rm(outputZip, { force: true });
await mkdir(stagingDir, { recursive: true });

for (const file of includeFiles) {
  const source = join(root, file);
  const info = await stat(source).catch(() => null);
  if (info?.isFile()) {
    await copyOneFile(source, join(stagingDir, file));
  } else {
    excluded.push(`${file} (missing)`);
  }
}

for (const dir of includeDirs) {
  const source = join(root, dir);
  const info = await stat(source).catch(() => null);
  if (info?.isDirectory()) {
    await copyDir(source, join(stagingDir, dir));
  } else {
    excluded.push(`${dir}/ (missing)`);
  }
}

const manifest = {
  packageName,
  generatedAt: new Date().toISOString(),
  includeFiles,
  includeDirs,
  copiedCount: copied.length,
  excludes: {
    names: [...excludedNames].sort(),
    filePatterns: excludedFilePatterns.map((pattern) => pattern.toString()),
    matched: excluded.sort(),
  },
  docker: {
    packageCompose: 'docker-compose.package.yml',
    frontendDockerfile: 'Dockerfile',
    frontendNginx: 'nginx.real-e2e.conf',
    apiGatewayConfig: 'api-gateway/nginx.conf',
  },
};

await writeFile(join(stagingDir, 'PACKAGE_MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await writeFile(join(stagingDir, 'PACKAGE_FILE_LIST.txt'), `${copied.sort().join('\n')}\n`, 'utf8');

let archivePath = output7z;
if (commandExists('7z')) {
  const result = spawnSync('7z', ['a', '-t7z', output7z, packageName], {
    cwd: stagingRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
} else {
  archivePath = outputZip;
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `Compress-Archive -Path '${packageName}' -DestinationPath '${outputZip}' -Force`],
    { cwd: stagingRoot, stdio: 'inherit' },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const archiveInfo = await stat(archivePath);
const archiveHash = await sha256(archivePath);
console.log(`PACKAGE=${archivePath}`);
console.log(`SIZE=${archiveInfo.size}`);
console.log(`SHA256=${archiveHash}`);
console.log(`STAGING=${stagingDir}`);
