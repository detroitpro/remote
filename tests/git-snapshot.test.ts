import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRepoSnapshotFromState,
  buildUnavailableWindowSnapshot,
  buildWindowSnapshot,
  createDebouncedCallback,
  resolveRepositories,
  snapshotSignature,
} from '../src/shared/git-snapshot.js';

test('buildRepoSnapshotFromState reads repository.state', () => {
  const snapshot = buildRepoSnapshotFromState('file:///workspace/repo', 'repo', {
    HEAD: {
      name: 'feature/git',
      ahead: 2,
      behind: 1,
      upstream: { remote: 'origin', name: 'main' },
    },
    indexChanges: [{ uri: { toString: () => 'file:///workspace/repo/a.ts' } }],
    workingTreeChanges: [{ uri: { toString: () => 'file:///workspace/repo/b.ts' } }],
    untrackedChanges: [{ uri: { toString: () => 'file:///workspace/repo/new.ts' } }],
    mergeChanges: [{ uri: { toString: () => 'file:///workspace/repo/conflict.ts' } }],
  });

  assert.equal(snapshot.branch, 'feature/git');
  assert.equal(snapshot.upstream, 'origin/main');
  assert.equal(snapshot.ahead, 2);
  assert.equal(snapshot.behind, 1);
  assert.equal(snapshot.staged, 1);
  assert.equal(snapshot.changed, 1);
  assert.equal(snapshot.untracked, 1);
  assert.equal(snapshot.merge, 1);
  assert.equal(snapshot.changedCount, 4);
});

test('buildWindowSnapshot aggregates across repos without status()', () => {
  const snapshot = buildWindowSnapshot(
    [
      {
        rootUri: 'file:///workspace/repo-a',
        state: {
          workingTreeChanges: [{ uri: { toString: () => 'file:///workspace/repo-a/a.ts' } }],
        },
      },
      {
        rootUri: 'file:///workspace/repo-b',
        state: {
          indexChanges: [{ uri: { toString: () => 'file:///workspace/repo-b/b.ts' } }],
        },
      },
    ],
    'repo-workspace',
    'workspace',
    'state-change',
  );

  assert.equal(snapshot.available, true);
  assert.equal(snapshot.changedCount, 2);
  assert.equal(snapshot.repoBreakdown.length, 2);
  assert.equal(snapshot.repoBreakdown[0]?.label, 'repo-a');
  assert.equal(snapshot.repoBreakdown[1]?.changedCount, 1);
});

test('snapshotSignature skips identical payloads', () => {
  const first = buildWindowSnapshot(
    [{
      rootUri: 'file:///workspace/repo',
      state: { workingTreeChanges: [{ uri: { toString: () => 'file:///workspace/repo/a.ts' } }] },
    }],
    'repo',
    'repo',
    'initial',
    1000,
  );
  const second = buildWindowSnapshot(
    [{
      rootUri: 'file:///workspace/repo',
      state: { workingTreeChanges: [{ uri: { toString: () => 'file:///workspace/repo/a.ts' } }] },
    }],
    'repo',
    'repo',
    'state-change',
    2000,
  );
  const different = buildWindowSnapshot(
    [{
      rootUri: 'file:///workspace/repo',
      state: {
        workingTreeChanges: [
          { uri: { toString: () => 'file:///workspace/repo/a.ts' } },
          { uri: { toString: () => 'file:///workspace/repo/b.ts' } },
        ],
      },
    }],
    'repo',
    'repo',
    'state-change',
    3000,
  );

  assert.equal(snapshotSignature(first), snapshotSignature(second));
  assert.notEqual(snapshotSignature(first), snapshotSignature(different));
});

test('resolveRepositories prefers exact then nested then all', () => {
  const repos = [
    { rootUri: 'file:///workspace/monorepo', state: {} },
    { rootUri: 'file:///workspace/monorepo/packages/a', state: {} },
    { rootUri: 'file:///other', state: {} },
  ];

  assert.deepEqual(
    resolveRepositories(repos, 'file:///workspace/monorepo/packages/a').map(repo => repo.rootUri),
    ['file:///workspace/monorepo/packages/a'],
  );
  assert.deepEqual(
    resolveRepositories(repos, 'file:///workspace/monorepo/apps/web').map(repo => repo.rootUri),
    ['file:///workspace/monorepo'],
  );
  assert.deepEqual(
    resolveRepositories(repos, null).map(repo => repo.rootUri),
    repos.map(repo => repo.rootUri),
  );
});

test('buildUnavailableWindowSnapshot reports unavailable git extension', () => {
  const snapshot = buildUnavailableWindowSnapshot('workspace', 'initial');
  assert.equal(snapshot.available, false);
  assert.equal(snapshot.changedCount, 0);
  assert.deepEqual(snapshot.repoBreakdown, []);
  assert.equal(snapshot.reason, 'initial');
});

test('createDebouncedCallback debounces snapshot emission', () => {
  let calls = 0;
  const timers: Array<{ fn: () => void; delay: number }> = [];
  const debounced = createDebouncedCallback(
    () => { calls += 1; },
    750,
    (fn, delay) => {
      const handle = { fn, delay };
      timers.push(handle);
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    handle => {
      const timer = handle as unknown as { fn: () => void };
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);
    },
  );

  debounced.schedule();
  debounced.schedule();
  assert.equal(calls, 0);
  assert.equal(timers.length, 1);

  timers[0]?.fn();
  assert.equal(calls, 1);
});

test('createDebouncedCallback flush runs pending callback immediately', () => {
  let calls = 0;
  const timers: Array<{ fn: () => void; delay: number }> = [];
  const debounced = createDebouncedCallback(
    () => { calls += 1; },
    750,
    (fn, delay) => {
      const handle = { fn, delay };
      timers.push(handle);
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    handle => {
      const timer = handle as unknown as { fn: () => void };
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);
    },
  );

  debounced.schedule();
  debounced.flush();
  assert.equal(calls, 1);
  assert.equal(timers.length, 0);
});
