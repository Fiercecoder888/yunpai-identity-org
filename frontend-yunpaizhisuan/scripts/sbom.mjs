#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const lockfilePath = (process.env.YUNPAI_LOCKFILE ?? 'pnpm-lock.yaml');

const parsePackageKey = (key) => {
  const bare = key.includes('(') ? key.slice(0, key.indexOf('(')) : key;
  if (bare.startsWith('/') || bare.startsWith('http') || bare.startsWith('file:') || bare.startsWith('git+')) {
    return null;
  }
  const at = bare.lastIndexOf('@');
  if (at <= 0) return null;
  const name = bare.slice(0, at);
  const version = bare.slice(at + 1);
  if (!name || !version) return null;
  return { name, version };
};

const readLockfile = async (root) => {
  try {
    return await readFile(resolve(root, lockfilePath), 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
};

const parseLockfile = (text) => {
  const packages = [];
  const seen = new Set();
  let inPackages = false;
  let pendingKey = null;

  for (const rawLine of text.split(/\r?\n/)) {
    if (!inPackages) {
      if (/^packages:\s*$/.test(rawLine)) {
        inPackages = true;
      }
      continue;
    }
    if (/^snapshots:\s*$/.test(rawLine)) break;

    const keyMatch = rawLine.match(/^ {2}([^:]+):\s*$/);
    if (keyMatch) {
      const parsed = parsePackageKey(keyMatch[1]);
      if (parsed) {
        pendingKey = parsed;
        packages.push({ ...parsed, integrity: null });
        seen.add(`${parsed.name}@${parsed.version}`);
      } else {
        pendingKey = null;
      }
      continue;
    }

    const resolutionMatch = rawLine.match(/^\s+resolution:\s*\{[^}]*integrity:\s*(sha[0-9]+-[A-Za-z0-9+/=_-]+)/);
    if (resolutionMatch && pendingKey) {
      packages[packages.length - 1].integrity = resolutionMatch[1];
    }
  }

  return packages;
};

const root = process.cwd();
const text = await readLockfile(root);
if (text === null) {
  console.error(`sbom gate: blocked - lockfile not found at ${lockfilePath}`);
  process.exitCode = 2;
} else {
  const packages = parseLockfile(text);
  const sbom = {
    schemaVersion: 1,
    component: 'yunpaizhisuan-fe-demo',
    lockfileVersion: text.match(/^lockfileVersion:\s*'?([^'\s]+)'?\s*$/m)?.[1] ?? 'unknown',
    generatedAt: new Date().toISOString(),
    packageCount: packages.length,
    packages,
  };

  const outputDir = resolve(root, 'scripts/test-outcomes');
  await mkdir(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, `sbom-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(outputPath, `${JSON.stringify(sbom, null, 2)}\n`);

  console.log(`sbom: generated ${packages.length} package entries from ${lockfilePath}`);
  console.log(`sbom: written to ${outputPath}`);
}
