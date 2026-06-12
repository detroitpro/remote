import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename } from 'path';
import type { StateManager } from './state-manager.js';
import type { OpenSourceControlRequest, OpenSourceControlResult } from '../shared/extension-bridge.js';
import type { ExtensionBridgeDiagnostics } from '../shared/diagnostics.js';
import {
  openSourceControlRequestPath,
  openSourceControlResultPath,
} from '../shared/extension-bridge.js';

const OPEN_SOURCE_CONTROL_TIMEOUT_MS = 5000;
const OPEN_SOURCE_CONTROL_POLL_MS = 125;

export class ExtensionFileBridge {
  private readonly dataDir: string;

  constructor(dataDir: string, _stateManager: StateManager) {
    this.dataDir = dataDir;
  }

  start(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  stop(): void {
    // no-op
  }

  getDiagnostics(): ExtensionBridgeDiagnostics {
    return {
      dataDirName: basename(this.dataDir),
    };
  }

  async requestOpenSourceControl(requestId: string): Promise<void> {
    const request: OpenSourceControlRequest = {
      requestId,
      requestedAt: Date.now(),
    };

    writeFileSync(
      openSourceControlRequestPath(this.dataDir),
      JSON.stringify(request) + '\n',
      'utf-8',
    );

    const deadline = Date.now() + OPEN_SOURCE_CONTROL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const result = this.readOpenSourceControlResult();
      if (result?.requestId === requestId) {
        if (result.ok) return;
        throw new Error(result.error || 'Open Source Control failed');
      }
      await sleep(OPEN_SOURCE_CONTROL_POLL_MS);
    }

    throw new Error('Timed out waiting for extension to open Source Control');
  }

  private readOpenSourceControlResult(): OpenSourceControlResult | null {
    const path = openSourceControlResultPath(this.dataDir);
    if (!existsSync(path)) return null;

    try {
      const raw = readFileSync(path, 'utf-8').trim();
      if (!raw) return null;
      return JSON.parse(raw) as OpenSourceControlResult;
    } catch {
      return null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
