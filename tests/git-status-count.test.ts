import assert from 'node:assert/strict';
import test from 'node:test';
import { countGitChanges } from '../src/shared/git-status-count.js';

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
