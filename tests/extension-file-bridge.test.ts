import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ExtensionFileBridge } from '../src/server/extension-file-bridge.js';
import { StateManager } from '../src/server/state-manager.js';
import {
  openSourceControlResultPath,
} from '../src/shared/extension-bridge.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cursor-remote-bridge-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('extension file bridge', () => {
  it('reports data dir diagnostics without git status files', () => {
    const dataDir = makeTempDir();
    const manager = new StateManager(0);
    const bridge = new ExtensionFileBridge(dataDir, manager);

    const diagnostics = bridge.getDiagnostics();
    assert.equal(diagnostics.dataDirName.length > 0, true);
    assert.equal(diagnostics.dataDirPath.length > 0, true);
    assert.deepEqual(Object.keys(diagnostics), ['dataDirName', 'dataDirPath']);
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
