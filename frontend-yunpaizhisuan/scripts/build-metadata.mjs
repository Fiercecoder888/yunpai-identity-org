import { execFileSync } from 'node:child_process';

const UNKNOWN = 'unknown';
const PLACEHOLDER_RE = /<(?:[^>]+)>|changeme|change[_-]?me|replace[_-]?me|your[_-]?(?:key|token|secret|password)|placeholder|\bxxxx+\b/i;

export const BUILD_COMMIT_META_NAME = 'yunpai-build-commit';
export const BUILD_BRANCH_META_NAME = 'yunpai-build-branch';
export const BUILD_TIME_META_NAME = 'yunpai-build-time';
export const BUILD_DIRTY_META_NAME = 'yunpai-build-dirty';

const defaultGit = (args, cwd) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

const readGit = (git, args, cwd, fallback = UNKNOWN, allowEmpty = false) => {
  try {
    const value = git(args, cwd);
    return allowEmpty ? value : value || fallback;
  } catch {
    return fallback;
  }
};

const parseDirty = (value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};

export function resolveBuildMetadata({ env = process.env, cwd = process.cwd(), now = () => new Date(), git = defaultGit } = {}) {
  const explicitDirty = parseDirty(env.YUNPAI_BUILD_DIRTY);
  const gitStatus = explicitDirty === undefined ? readGit(git, ['status', '--porcelain'], cwd, UNKNOWN, true) : '';

  return {
    commit: env.YUNPAI_BUILD_COMMIT || readGit(git, ['rev-parse', 'HEAD'], cwd),
    branch: env.YUNPAI_BUILD_BRANCH || readGit(git, ['branch', '--show-current'], cwd),
    buildTime: env.YUNPAI_BUILD_TIME || now().toISOString(),
    dirty: explicitDirty ?? (gitStatus === UNKNOWN || gitStatus.length > 0),
  };
}

export function assertReleaseMetadata(metadata) {
  for (const field of ['commit', 'branch', 'buildTime']) {
    if (typeof metadata?.[field] !== 'string' || metadata[field].trim() === '' || metadata[field] === UNKNOWN) {
      throw new Error(`Release build metadata ${field} must be set and cannot be unknown`);
    }
  }
  if (!/^[0-9a-f]{40}$/.test(metadata.commit)) {
    throw new Error('Release build metadata commit must be a 40-character lowercase SHA-1');
  }
  if (Number.isNaN(Date.parse(metadata.buildTime))) {
    throw new Error('Release build metadata buildTime must be an ISO-8601 timestamp');
  }
  if (!/Z$/.test(metadata.buildTime)) {
    throw new Error('Release build metadata buildTime must be a UTC timestamp ending in Z');
  }
  if (metadata.dirty !== false) {
    throw new Error('Release build metadata dirty must be false');
  }
  for (const field of ['commit', 'branch', 'buildTime']) {
    if (PLACEHOLDER_RE.test(metadata[field])) {
      throw new Error(`Release build metadata ${field} must not contain placeholder text`);
    }
  }
  return metadata;
}

export const createBuildMetaTags = (metadata) => [
  {
    tag: 'meta',
    attrs: { name: BUILD_COMMIT_META_NAME, content: metadata.commit },
    injectTo: 'head',
  },
  {
    tag: 'meta',
    attrs: { name: BUILD_BRANCH_META_NAME, content: metadata.branch },
    injectTo: 'head',
  },
  {
    tag: 'meta',
    attrs: { name: BUILD_TIME_META_NAME, content: metadata.buildTime },
    injectTo: 'head',
  },
  {
    tag: 'meta',
    attrs: { name: BUILD_DIRTY_META_NAME, content: String(metadata.dirty) },
    injectTo: 'head',
  },
];

export const serializeBuildMetadata = (metadata) => `${JSON.stringify(metadata, null, 2)}\n`;
