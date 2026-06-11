import * as vscode from 'vscode';
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from 'fs';
import type { UnifiedOutputChannel } from './output-channel.js';
import type { ServerManager } from './server-manager.js';
import type {
  GitSnapshotPushPayload,
  GitStatusInfo,
  OpenSourceControlRequest,
  OpenSourceControlResult,
} from '../../src/shared/extension-bridge.js';
import {
  gitBridgeDebugPath,
  gitStatusBridgePath,
  openSourceControlRequestPath,
  openSourceControlResultPath,
} from '../../src/shared/extension-bridge.js';
import type { GitBridgeDebugInfo, GitBridgeRepoDebugInfo } from '../../src/shared/diagnostics.js';
import { countGitChanges, countGitChangesAcrossRepositories } from '../../src/shared/git-status-count.js';
import { resolveWorkspaceIdentity } from '../../src/shared/workspace-identity.js';

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
  private lastPushedSignature = '';
  private repoChangeDebounce: ReturnType<typeof setTimeout> | null = null;
  private refreshInFlight: Promise<void> | null = null;
  private suppressRepoChange = false;
  private extensionVersion: string;
  private extensionInstanceId: string;
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
    this.extensionInstanceId = context.globalState.get<string>('gitBridgeInstanceId')
      ?? vscode.env.sessionId
      ?? `ext-${Date.now()}`;
    void context.globalState.update('gitBridgeInstanceId', this.extensionInstanceId);
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
      this.lastWrittenGitStatus = '';
      this.lastPushedSignature = '';
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

  private resolveWindowKey(): string {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const includeQualifier = vscode.workspace
      .getConfiguration('cursorRemote')
      .get<boolean>('windowTitleQualifier', true);
    if (!folder) {
      return vscode.workspace.name ?? 'unknown';
    }
    return resolveWorkspaceIdentity({
      workspacePath: folder.uri.fsPath,
      workspaceName: vscode.workspace.name,
      authority: folder.uri.authority || undefined,
      includeQualifier,
    });
  }

  private async refreshGitStatusNow(runGitStatus: boolean): Promise<void> {
    const windowName = vscode.workspace.name
      ?? vscode.workspace.workspaceFolders?.[0]?.name
      ?? 'unknown';
    const windowKey = this.resolveWindowKey();
    const debugBase: GitBridgeDebugInfo = {
      updatedAt: Date.now(),
      extensionVersion: this.extensionVersion,
      windowName,
      windowKey,
      isOwner: this.serverManager.isOwner,
      gitApiAvailable: false,
      repoCount: 0,
      repoResolved: false,
      runGitStatus,
    };

    const git = await this.getGitApi();
    if (!git) {
      this.writeGitBridgeDebug({ ...debugBase, lastError: 'vscode.git unavailable' });
      await this.pushGitSnapshot({
        available: false,
        changedCount: 0,
        updatedAt: Date.now(),
        source: 'vscode.git',
        windowKey,
      }, windowKey, debugBase);
      return;
    }

    debugBase.gitApiAvailable = true;
    debugBase.repoCount = git.repositories.length;
    const repositories = this.resolveRepositories(git);
    this.ensureRepoListeners(repositories);
    if (!repositories.length) {
      this.writeGitBridgeDebug({ ...debugBase, lastError: 'no repository for workspace' });
      await this.pushGitSnapshot({
        available: false,
        changedCount: 0,
        updatedAt: Date.now(),
        source: 'vscode.git',
        windowKey,
      }, windowKey, debugBase);
      return;
    }

    debugBase.repoResolved = true;
    debugBase.repoLabel = vscode.workspace.workspaceFolders?.[0]?.name || repositories[0].rootUri.fsPath.split(/[\\/]/).pop() || 'workspace';

    if (runGitStatus) {
      this.suppressRepoChange = true;
      try {
        for (const repo of repositories) {
          await repo.status?.();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.outputChannel.warn(`[git-bridge] repo.status() failed: ${message}`);
        debugBase.lastError = message;
      } finally {
        this.suppressRepoChange = false;
      }
    }

    const repoBreakdown: GitBridgeRepoDebugInfo[] = repositories.map(repo => ({
      rootUri: repo.rootUri.toString(),
      label: repo.rootUri.fsPath.split(/[\\/]/).pop() || repo.rootUri.fsPath,
      changedCount: countGitChanges(repo.state),
    }));
    const changedCount = countGitChangesAcrossRepositories(repositories.map(repo => repo.state));
    debugBase.changedCount = changedCount;
    debugBase.repoBreakdown = repoBreakdown;

    const payload: GitStatusInfo = {
      available: true,
      changedCount,
      repoLabel: debugBase.repoLabel,
      updatedAt: Date.now(),
      source: 'vscode.git',
      windowKey,
    };
    await this.pushGitSnapshot(payload, windowKey, debugBase, repoBreakdown);
  }

  private async pushGitSnapshot(
    gitStatus: GitStatusInfo,
    windowKey: string,
    debugBase: GitBridgeDebugInfo,
    repoBreakdown?: GitBridgeRepoDebugInfo[],
  ): Promise<void> {
    const pushPayload: GitSnapshotPushPayload = {
      windowKey,
      gitStatus,
      repoBreakdown,
      updatedAt: gitStatus.updatedAt,
      extensionInstanceId: this.extensionInstanceId,
    };

    const signature = `${windowKey}:${gitStatus.available}:${gitStatus.changedCount}:${JSON.stringify(repoBreakdown ?? [])}`;

    if (this.serverManager.isOwner) {
      this.writeGitStatus(gitStatus);
    }

    let pushDebug: Partial<GitBridgeDebugInfo> = {};
    if (signature !== this.lastPushedSignature) {
      pushDebug = await this.postGitSnapshot(pushPayload);
      if (pushDebug.lastPushOk) {
        this.lastPushedSignature = signature;
      }
    } else {
      pushDebug = { lastPushOk: true, lastPushAt: debugBase.updatedAt };
    }

    this.writeGitBridgeDebug({ ...debugBase, ...pushDebug });
  }

  private async postGitSnapshot(payload: GitSnapshotPushPayload): Promise<Partial<GitBridgeDebugInfo>> {
    const pushUrl = this.serverManager.getGitSnapshotPushUrl();
    try {
      const resp = await fetch(pushUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(2500),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        return {
          lastPushAt: Date.now(),
          lastPushOk: false,
          lastPushError: text || `HTTP ${resp.status}`,
        };
      }
      return {
        lastPushAt: Date.now(),
        lastPushOk: true,
      };
    } catch (err) {
      return {
        lastPushAt: Date.now(),
        lastPushOk: false,
        lastPushError: err instanceof Error ? err.message : String(err),
      };
    }
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

  private resolveRepositories(git: GitExtensionApi): GitRepository[] {
    if (!git.repositories.length) return [];
    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceUri) return [...git.repositories];

    const workspacePath = normalizePath(workspaceUri.fsPath);
    const exactMatches = git.repositories.filter(repo => normalizePath(repo.rootUri.fsPath) === workspacePath);
    if (exactMatches.length) return exactMatches;

    const nestedMatches = git.repositories.filter(repo => workspacePath.startsWith(normalizePath(repo.rootUri.fsPath) + '/'));
    return nestedMatches.length ? nestedMatches : [...git.repositories];
  }

  private writeGitStatus(payload: GitStatusInfo | null): void {
    const signature = payload
      ? `${payload.windowKey}:${payload.available}:${payload.changedCount}:${payload.repoLabel}`
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
