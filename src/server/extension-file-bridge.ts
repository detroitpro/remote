import { existsSync, mkdirSync, readFileSync, statSync, watch, type FSWatcher, writeFileSync } from 'fs';
import { basename } from 'path';
import type { StateManager } from './state-manager.js';
import type { GitSnapshotPushPayload, GitStatusInfo, OpenSourceControlRequest, OpenSourceControlResult } from '../shared/extension-bridge.js';
import type { ExtensionBridgeDiagnostics, GitBridgeDebugInfo } from '../shared/diagnostics.js';
import {
  gitBridgeDebugPath,
  gitStatusBridgePath,
  openSourceControlRequestPath,
  openSourceControlResultPath,
} from '../shared/extension-bridge.js';

const OPEN_SOURCE_CONTROL_TIMEOUT_MS = 5000;
const OPEN_SOURCE_CONTROL_POLL_MS = 125;

export class ExtensionFileBridge {
  private readonly dataDir: string;
  private readonly stateManager: StateManager;
  private watcher: FSWatcher | null = null;
  private lastGitStatusRaw = '';

  constructor(dataDir: string, stateManager: StateManager) {
    this.dataDir = dataDir;
    this.stateManager = stateManager;
  }

  start(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }

    this.refreshGitStatus();

    try {
      this.watcher = watch(this.dataDir, (_eventType, filename) => {
        if (filename !== 'git-status.json') return;
        this.refreshGitStatus();
      });
    } catch (err) {
      console.warn(`[extension-bridge] Failed to watch ${this.dataDir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  getDiagnostics(): ExtensionBridgeDiagnostics {
    const gitPath = gitStatusBridgePath(this.dataDir);
    const debugPath = gitBridgeDebugPath(this.dataDir);
    let gitStatusFileMtime: number | null = null;
    let gitStatusRaw: string | null = null;
    let gitStatusParsed: GitStatusInfo | null = null;

    if (existsSync(gitPath)) {
      try {
        gitStatusFileMtime = statSync(gitPath).mtimeMs;
        gitStatusRaw = readFileSync(gitPath, 'utf-8').trim() || null;
        if (gitStatusRaw && gitStatusRaw !== 'null') {
          gitStatusParsed = JSON.parse(gitStatusRaw) as GitStatusInfo;
        }
      } catch {
        // leave parsed null
      }
    }

    let gitBridgeDebug: GitBridgeDebugInfo | null = null;
    if (existsSync(debugPath)) {
      try {
        const raw = readFileSync(debugPath, 'utf-8').trim();
        if (raw) gitBridgeDebug = JSON.parse(raw) as GitBridgeDebugInfo;
      } catch {
        // leave null
      }
    }

    return {
      dataDirName: basename(this.dataDir),
      gitStatusFileExists: existsSync(gitPath),
      gitStatusFileMtime,
      gitStatusRaw,
      gitStatusParsed,
      gitBridgeDebug,
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
      'utf-8'
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

  private refreshGitStatus(): void {
    const path = gitStatusBridgePath(this.dataDir);
    if (!existsSync(path)) return;

    try {
      const raw = readFileSync(path, 'utf-8').trim();
      if (!raw || raw === this.lastGitStatusRaw) return;
      const parsed = JSON.parse(raw) as GitStatusInfo | null;
      this.lastGitStatusRaw = raw;
      if (parsed?.windowKey) {
        this.stateManager.upsertGitWindowSnapshot({
          windowKey: parsed.windowKey,
          gitStatus: parsed,
          updatedAt: parsed.updatedAt,
        });
        return;
      }
      this.stateManager.updateGitStatus(parsed);
    } catch (err) {
      console.warn(`[extension-bridge] Failed to read git status: ${err instanceof Error ? err.message : String(err)}`);
    }
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
