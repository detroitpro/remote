import * as vscode from 'vscode';
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from 'fs';
import type { UnifiedOutputChannel } from './output-channel.js';
import type { ServerManager } from './server-manager.js';
import type { GitStatusInfo, OpenSourceControlRequest, OpenSourceControlResult } from '../../src/shared/extension-bridge.js';
import {
  gitBridgeDebugPath,
  gitStatusBridgePath,
  openSourceControlRequestPath,
  openSourceControlResultPath,
} from '../../src/shared/extension-bridge.js';
import type { GitBridgeDebugInfo } from '../../src/shared/diagnostics.js';
import { countGitChanges } from '../../src/shared/git-status-count.js';

const REFRESH_INTERVAL_MS = 5000;
const REPO_CHANGE_DEBOUNCE_MS = 500;

interface GitExtensionApi {
  repositories: GitRepository[];
  getRepository?(uri: vscode.Uri): GitRepository | null;
}

interface GitRepository {
  rootUri: vscode.Uri;
  status?(): Promise<void>;
  state: {
    workingTreeChanges: Array<{ uri: vscode.Uri; resourceUri?: vscode.Uri }>;
    indexChanges: Array<{ uri: vscode.Uri; resourceUri?: vscode.Uri }>;
    mergeChanges: Array<{ uri: vscode.Uri; resourceUri?: vscode.Uri }>;
    untrackedChanges?: Array<{ uri: vscode.Uri; resourceUri?: vscode.Uri }>;
    onDidChange: vscode.Event<void>;
  };
}

export class GitStateBridge implements vscode.Disposable {
  private readonly context: vscode.ExtensionContext;
  private readonly outputChannel: UnifiedOutputChannel;
  private readonly serverManager: ServerManager;
  private requestWatcher: FSWatcher | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private repoListeners = new Map<string, vscode.Disposable>();
  private lastRequestId = '';
  private lastWrittenGitStatus = '';
  private repoChangeDebounce: ReturnType<typeof setTimeout> | null = null;
  private refreshInFlight: Promise<void> | null = null;
  private suppressRepoChange = false;
  private extensionVersion: string;
  private disposed = false;

  constructor(
    context: vscode.ExtensionContext,
    outputChannel: UnifiedOutputChannel,
    serverManager: ServerManager,
  ) {
    this.context = context;
    this.outputChannel = outputChannel;
    this.serverManager = serverManager;
    this.extensionVersion = context.extension.packageJSON?.version ?? 'unknown';
  }

  start(): void {
    const dataDir = this.context.globalStorageUri.fsPath;
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    this.serverManager.on('stateChanged', () => {
      void this.handleOpenSourceControlRequest();
    });
    this.serverManager.on('started', () => {
      if (!this.serverManager.isOwner) return;
      this.lastWrittenGitStatus = '';
      void this.refreshGitStatus(true);
    });
    void this.refreshGitStatus(true);
    void this.handleOpenSourceControlRequest();

    this.refreshTimer = setInterval(() => {
      void this.refreshGitStatus(true);
    }, REFRESH_INTERVAL_MS);

    try {
      this.requestWatcher = watch(dataDir, (_eventType, filename) => {
        if (filename !== 'open-source-control-request.json') return;
        void this.handleOpenSourceControlRequest();
      });
    } catch (err) {
      this.outputChannel.warn(`[git-bridge] Failed to watch ${dataDir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.requestWatcher) {
      this.requestWatcher.close();
      this.requestWatcher = null;
    }
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.repoChangeDebounce) {
      clearTimeout(this.repoChangeDebounce);
      this.repoChangeDebounce = null;
    }
    for (const disposable of this.repoListeners.values()) {
      disposable.dispose();
    }
    this.repoListeners.clear();
  }

  private refreshGitStatus(runGitStatus = false): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = this.refreshGitStatusNow(runGitStatus).finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private scheduleRefreshFromRepoChange(): void {
    if (this.disposed) return;
    if (this.repoChangeDebounce) clearTimeout(this.repoChangeDebounce);
    this.repoChangeDebounce = setTimeout(() => {
      this.repoChangeDebounce = null;
      void this.refreshGitStatus(false);
    }, REPO_CHANGE_DEBOUNCE_MS);
  }

  private async refreshGitStatusNow(runGitStatus: boolean): Promise<void> {
    const windowName = vscode.workspace.name
      ?? vscode.workspace.workspaceFolders?.[0]?.name
      ?? 'unknown';
    const debugBase: GitBridgeDebugInfo = {
      updatedAt: Date.now(),
      extensionVersion: this.extensionVersion,
      windowName,
      isOwner: this.serverManager.isOwner,
      gitApiAvailable: false,
      repoCount: 0,
      repoResolved: false,
      runGitStatus,
    };

    const git = await this.getGitApi();
    if (!git) {
      this.writeGitBridgeDebug({ ...debugBase, lastError: 'vscode.git unavailable' });
      this.writeGitStatus(null);
      return;
    }

    debugBase.gitApiAvailable = true;
    debugBase.repoCount = git.repositories.length;
    this.ensureRepoListeners(git.repositories);
    const repo = this.resolveRepository(git);
    if (!repo) {
      this.writeGitBridgeDebug({ ...debugBase, lastError: 'no repository for workspace' });
      this.writeGitStatus(null);
      return;
    }

    debugBase.repoResolved = true;
    debugBase.repoLabel = vscode.workspace.workspaceFolders?.[0]?.name || repo.rootUri.fsPath.split(/[\\/]/).pop() || 'workspace';

    if (runGitStatus && repo.status) {
      this.suppressRepoChange = true;
      try {
        await repo.status();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.outputChannel.warn(`[git-bridge] repo.status() failed: ${message}`);
        debugBase.lastError = message;
      } finally {
        this.suppressRepoChange = false;
      }
    }

    const changedCount = countGitChanges(repo.state);
    debugBase.changedCount = changedCount;
    this.writeGitBridgeDebug(debugBase);

    const payload: GitStatusInfo = {
      available: true,
      changedCount,
      repoLabel: debugBase.repoLabel,
      updatedAt: Date.now(),
      source: 'vscode.git',
    };
    this.writeGitStatus(payload);
  }

  private ensureRepoListeners(repositories: GitRepository[]): void {
    const nextKeys = new Set(repositories.map(repo => repo.rootUri.toString()));

    for (const [key, disposable] of this.repoListeners) {
      if (nextKeys.has(key)) continue;
      disposable.dispose();
      this.repoListeners.delete(key);
    }

    for (const repo of repositories) {
      const key = repo.rootUri.toString();
      if (this.repoListeners.has(key)) continue;
      this.repoListeners.set(key, repo.state.onDidChange(() => {
        if (this.suppressRepoChange) return;
        this.scheduleRefreshFromRepoChange();
      }));
    }
  }

  private async getGitApi(): Promise<GitExtensionApi | null> {
    try {
      const extension = vscode.extensions.getExtension('vscode.git');
      if (!extension) return null;
      const exports = extension.isActive ? extension.exports : await extension.activate();
      const api = exports?.getAPI?.(1) as GitExtensionApi | undefined;
      return api ?? null;
    } catch (err) {
      this.outputChannel.warn(`[git-bridge] Failed to activate vscode.git: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private resolveRepository(git: GitExtensionApi): GitRepository | null {
    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (workspaceUri && git.getRepository) {
      const repo = git.getRepository(workspaceUri);
      if (repo) return repo;
    }
    return this.pickRepository(git.repositories);
  }

  private pickRepository(repositories: GitRepository[]): GitRepository | null {
    if (!repositories.length) return null;
    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceUri) return repositories[0];

    const workspacePath = normalizePath(workspaceUri.fsPath);
    return repositories.find(repo => normalizePath(repo.rootUri.fsPath) === workspacePath)
      || repositories.find(repo => workspacePath.startsWith(normalizePath(repo.rootUri.fsPath) + '/'))
      || repositories[0];
  }

  private writeGitStatus(payload: GitStatusInfo | null): void {
    if (!this.serverManager.isOwner) return;

    const signature = payload
      ? `${payload.available}:${payload.changedCount}:${payload.repoLabel}`
      : 'null';
    if (signature === this.lastWrittenGitStatus) return;

    writeFileSync(
      gitStatusBridgePath(this.context.globalStorageUri.fsPath),
      JSON.stringify(payload) + '\n',
      'utf-8',
    );
    this.lastWrittenGitStatus = signature;
  }

  private writeGitBridgeDebug(payload: GitBridgeDebugInfo): void {
    writeFileSync(
      gitBridgeDebugPath(this.context.globalStorageUri.fsPath),
      JSON.stringify(payload) + '\n',
      'utf-8',
    );
  }

  private async handleOpenSourceControlRequest(): Promise<void> {
    if (this.disposed) return;
    const path = openSourceControlRequestPath(this.context.globalStorageUri.fsPath);
    if (!existsSync(path)) return;

    let request: OpenSourceControlRequest;
    try {
      request = JSON.parse(readFileSync(path, 'utf-8')) as OpenSourceControlRequest;
    } catch {
      return;
    }

    if (!request.requestId || request.requestId === this.lastRequestId) return;
    this.lastRequestId = request.requestId;

    let result: OpenSourceControlResult;
    try {
      await vscode.commands.executeCommand('cursorRemote.openSourceControl');
      result = {
        requestId: request.requestId,
        ok: true,
        completedAt: Date.now(),
      };
    } catch (err) {
      result = {
        requestId: request.requestId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        completedAt: Date.now(),
      };
    }

    writeFileSync(
      openSourceControlResultPath(this.context.globalStorageUri.fsPath),
      JSON.stringify(result) + '\n',
      'utf-8'
    );
  }
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
