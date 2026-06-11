import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ExtensionFileBridge } from '../src/server/extension-file-bridge.js';
import { StateManager } from '../src/server/state-manager.js';
import {
  gitStatusBridgePath,
  openSourceControlResultPath,
} from '../src/shared/extension-bridge.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cursor-remote-bridge-'));
  tempDirs.push(dir);
  return dir;
}

function nextTick(ms = 25): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('extension file bridge', () => {
  it('loads git status updates from the shared file', async () => {
    const dataDir = makeTempDir();
    const manager = new StateManager(0);
    manager.updateWindows([{ id: 'w1', title: 'cursor-ide-remote', url: '' }], 'w1');
    const bridge = new ExtensionFileBridge(dataDir, manager);
    bridge.start();

    writeFileSync(gitStatusBridgePath(dataDir), JSON.stringify({
      available: true,
      changedCount: 4,
      repoLabel: 'cursor-ide-remote',
      updatedAt: Date.now(),
      source: 'vscode.git',
      windowKey: 'cursor-ide-remote',
    }) + '\n', 'utf-8');

    await nextTick(75);
    bridge.stop();

    assert.equal(manager.getCurrentState().gitStatus?.available, true);
    assert.equal(manager.getCurrentState().gitStatus?.changedCount, 4);
    assert.equal(manager.getCurrentState().gitStatus?.repoLabel, 'cursor-ide-remote');
    assert.equal(manager.getCurrentState().gitStatus?.source, 'vscode.git');
    assert.equal(manager.getCurrentState().gitStatus?.windowKey, 'cursor-ide-remote');
  });

  it('reports bridge diagnostics for git status files', () => {
    const dataDir = makeTempDir();
    const manager = new StateManager(0);
    const bridge = new ExtensionFileBridge(dataDir, manager);

    writeFileSync(gitStatusBridgePath(dataDir), 'null\n', 'utf-8');

    const diagnostics = bridge.getDiagnostics();
    assert.equal(diagnostics.gitStatusFileExists, true);
    assert.equal(diagnostics.gitStatusRaw, 'null');
    assert.equal(diagnostics.gitStatusParsed, null);
    assert.ok(diagnostics.dataDirName.length > 0);
  });

  it('waits for the extension ack when opening source control', async () => {
    const dataDir = makeTempDir();
    const manager = new StateManager(0);
    const bridge = new ExtensionFileBridge(dataDir, manager);

    const request = bridge.requestOpenSourceControl('cmd-open-scm');
    setTimeout(() => {
      writeFileSync(openSourceControlResultPath(dataDir), JSON.stringify({
        requestId: 'cmd-open-scm',
        ok: true,
        completedAt: Date.now(),
      }) + '\n', 'utf-8');
    }, 50);

    await assert.doesNotReject(request);
  });
});
