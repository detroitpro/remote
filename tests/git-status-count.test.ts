import assert from 'node:assert/strict';
import test from 'node:test';
import { countGitChanges, countGitChangesAcrossRepositories } from '../src/shared/git-status-count.js';

test('countGitChanges deduplicates across index and working tree', () => {
  const shared = { uri: { toString: () => 'file:///a.ts' } };
  assert.equal(countGitChanges({
    indexChanges: [shared],
    workingTreeChanges: [shared],
    untrackedChanges: [{ uri: { toString: () => 'file:///b.ts' } }],
  }), 2);
});

test('countGitChanges accepts legacy resourceUri shape', () => {
  assert.equal(countGitChanges({
    workingTreeChanges: [{ resourceUri: { toString: () => 'file:///legacy.ts' } }],
  }), 1);
});

test('countGitChanges returns 0 for empty state', () => {
  assert.equal(countGitChanges({}), 0);
});

test('countGitChangesAcrossRepositories sums multiple repositories', () => {
  assert.equal(countGitChangesAcrossRepositories([
    {
      workingTreeChanges: [{ uri: { toString: () => 'file:///repo-a/a.ts' } }],
      untrackedChanges: [{ uri: { toString: () => 'file:///repo-a/new.ts' } }],
    },
    {
      indexChanges: [{ uri: { toString: () => 'file:///repo-b/b.ts' } }],
      workingTreeChanges: [{ uri: { toString: () => 'file:///repo-b/c.ts' } }],
    },
  ]), 4);
});

test('countGitChangesAcrossRepositories deduplicates overlaps inside and across repos', () => {
  const shared = { uri: { toString: () => 'file:///shared.ts' } };
  assert.equal(countGitChangesAcrossRepositories([
    {
      indexChanges: [shared],
      workingTreeChanges: [shared],
    },
    {
      untrackedChanges: [shared],
      mergeChanges: [{ uri: { toString: () => 'file:///other.ts' } }],
    },
  ]), 2);
});
