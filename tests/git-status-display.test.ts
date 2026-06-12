import assert from 'node:assert/strict';
import test from 'node:test';
import { formatGitTreeItem, formatGitTooltipLine } from '../extension/src/git-status-display.js';

test('formatGitTreeItem shows initializing when summary is null', () => {
  assert.deepEqual(formatGitTreeItem(null), {
    label: 'Git: initializing',
    icon: 'source-control',
  });
});

test('formatGitTreeItem shows changes when git is available', () => {
  assert.deepEqual(formatGitTreeItem({
    available: true,
    changedCount: 3,
    repoLabel: 'my-repo',
  }), {
    label: 'Git changes: 3',
    description: 'my-repo',
    icon: 'source-control',
  });
});

test('formatGitTreeItem shows unavailable states', () => {
  assert.equal(formatGitTreeItem({
    available: false,
    changedCount: 0,
    error: 'vscode.git unavailable',
  }).label, 'Git: extension unavailable');

  assert.equal(formatGitTreeItem({
    available: false,
    changedCount: 0,
    error: 'no repository for workspace',
  }).label, 'Git: no repository');
});

test('formatGitTooltipLine includes description', () => {
  assert.equal(
    formatGitTooltipLine({ available: true, changedCount: 2, repoLabel: 'repo-a' }),
    'Git changes: 2 (repo-a)',
  );
});
