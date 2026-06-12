import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findGitSnapshotForTitle,
  resolveGitSnapshotForActiveWindow,
  StateManager,
} from '../src/server/state-manager.js';
import type { GitWindowSnapshot } from '../src/shared/extension-bridge.js';

function makeSnapshot(windowKey: string, changedCount: number): GitWindowSnapshot {
  return {
    windowKey,
    updatedAt: Date.now(),
    gitStatus: {
      available: true,
      changedCount,
      repoLabel: windowKey,
      updatedAt: Date.now(),
      source: 'vscode.git',
      windowKey,
    },
  };
}

describe('git snapshot push store', () => {
  it('findGitSnapshotForTitle matches exact and base workspace keys', () => {
    const map = new Map<string, GitWindowSnapshot>([
      ['cursor-ide-remote', makeSnapshot('cursor-ide-remote', 12)],
      ['other-repo [WSL: Ubuntu]', makeSnapshot('other-repo [WSL: Ubuntu]', 3)],
    ]);

    assert.equal(findGitSnapshotForTitle('cursor-ide-remote', map)?.gitStatus.changedCount, 12);
    assert.equal(findGitSnapshotForTitle('other-repo [WSL: Ubuntu]', map)?.gitStatus.changedCount, 3);
    assert.equal(findGitSnapshotForTitle('other-repo', map)?.gitStatus.changedCount, 3);
    assert.equal(findGitSnapshotForTitle('missing', map), undefined);
  });

  it('resolveGitSnapshotForActiveWindow falls back to sole snapshot when title does not match', () => {
    const map = new Map<string, GitWindowSnapshot>([
      ['cursor-ide-remote', makeSnapshot('cursor-ide-remote', 36)],
    ]);

    assert.equal(
      resolveGitSnapshotForActiveWindow('unexpected-cdp-title', map)
        ?.gitStatus.changedCount,
      36,
    );
  });

  it('resolveGitSnapshotForActiveWindow does not guess among multiple snapshots', () => {
    const map = new Map<string, GitWindowSnapshot>([
      ['repo-a', makeSnapshot('repo-a', 11)],
      ['repo-b', makeSnapshot('repo-b', 22)],
    ]);

    assert.equal(resolveGitSnapshotForActiveWindow('missing', map), undefined);
  });

  it('upsertGitWindowSnapshot updates active git status for matching window title', () => {
    const manager = new StateManager(0);
    manager.updateWindows([
      { id: 'w1', title: 'repo-a', url: '', wsUrl: 'ws://a' },
      { id: 'w2', title: 'repo-b', url: '', wsUrl: 'ws://b' },
    ], 'w1');

    manager.upsertGitWindowSnapshot({
      windowKey: 'repo-a',
      updatedAt: Date.now(),
      gitStatus: {
        available: true,
        changedCount: 11,
        repoLabel: 'repo-a',
        updatedAt: Date.now(),
        source: 'vscode.git',
        windowKey: 'repo-a',
      },
    });
    manager.upsertGitWindowSnapshot({
      windowKey: 'repo-b',
      updatedAt: Date.now(),
      gitStatus: {
        available: true,
        changedCount: 22,
        repoLabel: 'repo-b',
        updatedAt: Date.now(),
        source: 'vscode.git',
        windowKey: 'repo-b',
      },
    });

    assert.equal(manager.getCurrentState().gitStatus?.changedCount, 11);

    manager.updateWindows([
      { id: 'w1', title: 'repo-a', url: '', wsUrl: 'ws://a' },
      { id: 'w2', title: 'repo-b', url: '', wsUrl: 'ws://b' },
    ], 'w2');

    assert.equal(manager.getCurrentState().gitStatus?.changedCount, 22);
    const diagnostics = manager.getGitSnapshotDiagnostics('repo-b');
    assert.equal(diagnostics.activeWindowKey, 'repo-b');
    assert.equal(diagnostics.windowSnapshots['repo-a']?.changedCount, 11);
    assert.equal(diagnostics.windowSnapshots['repo-b']?.changedCount, 22);
  });

  it('upsertGitWindowSnapshot uses sole snapshot when active window title differs', () => {
    const manager = new StateManager(0);
    manager.updateWindows([
      { id: 'w1', title: 'unexpected-cdp-title', url: '', wsUrl: 'ws://a' },
    ], 'w1');

    manager.upsertGitWindowSnapshot({
      windowKey: 'cursor-ide-remote',
      updatedAt: Date.now(),
      gitStatus: {
        available: true,
        changedCount: 36,
        repoLabel: 'cursor-ide-remote',
        updatedAt: Date.now(),
        source: 'vscode.git',
        windowKey: 'cursor-ide-remote',
      },
    });

    assert.equal(manager.getCurrentState().gitStatus?.changedCount, 36);
  });
});
