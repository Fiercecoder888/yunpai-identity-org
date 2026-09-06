import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILD_BRANCH_META_NAME,
  BUILD_COMMIT_META_NAME,
  BUILD_DIRTY_META_NAME,
  BUILD_TIME_META_NAME,
  assertReleaseMetadata,
  createBuildMetaTags,
  resolveBuildMetadata,
} from './build-metadata.mjs';

const gitValues = new Map([
  ['rev-parse HEAD', 'a'.repeat(40)],
  ['branch --show-current', 'feature/current-none'],
  ['status --porcelain', ''],
]);
const git = (args) => gitValues.get(args.join(' ')) ?? '';
const now = () => new Date('2026-07-20T08:00:00.000Z');

test('uses clean local Git values when explicit build inputs are absent', () => {
  assert.deepEqual(resolveBuildMetadata({ env: {}, git, now }), {
    commit: 'a'.repeat(40),
    branch: 'feature/current-none',
    buildTime: '2026-07-20T08:00:00.000Z',
    dirty: false,
  });
});

test('reports a dirty or unavailable Git worktree without blocking a development build', () => {
  const dirtyGit = (args) => (args.join(' ') === 'status --porcelain' ? ' M src/app.tsx' : git(args));
  assert.equal(resolveBuildMetadata({ env: {}, git: dirtyGit, now }).dirty, true);
  assert.equal(resolveBuildMetadata({ env: {}, git: () => { throw new Error('missing'); }, now }).dirty, true);
});

test('explicit Docker or CI inputs override local Git values', () => {
  assert.deepEqual(
    resolveBuildMetadata({
      env: {
        YUNPAI_BUILD_COMMIT: 'b'.repeat(40),
        YUNPAI_BUILD_BRANCH: 'release/current-none',
        YUNPAI_BUILD_TIME: '2026-07-20T09:00:00.000Z',
        YUNPAI_BUILD_DIRTY: 'false',
      },
      git: () => { throw new Error('Git must not be needed'); },
      now,
    }),
    {
      commit: 'b'.repeat(40),
      branch: 'release/current-none',
      buildTime: '2026-07-20T09:00:00.000Z',
      dirty: false,
    },
  );
});

test('creates page metadata with the full build commit, branch, time, and dirty state', () => {
  const metadata = { commit: 'd'.repeat(40), branch: 'release/current-none', buildTime: '2026-07-20T08:00:00.000Z', dirty: false };

  assert.deepEqual(createBuildMetaTags(metadata), [
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
  ]);
});

test('release validation rejects missing, unknown, dirty, and invalid timestamp values', () => {
  const valid = { commit: 'c'.repeat(40), branch: 'release', buildTime: '2026-07-20T09:00:00.000Z', dirty: false };
  assert.equal(assertReleaseMetadata(valid), valid);
  assert.throws(() => assertReleaseMetadata({ ...valid, commit: 'unknown' }), /commit/);
  assert.throws(() => assertReleaseMetadata({ ...valid, branch: '' }), /branch/);
  assert.throws(() => assertReleaseMetadata({ ...valid, dirty: true }), /dirty/);
  assert.throws(() => assertReleaseMetadata({ ...valid, buildTime: 'not-a-date' }), /ISO-8601/);
});
