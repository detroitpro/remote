import * as vscode from 'vscode';
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from 'fs';
import type { UnifiedOutputChannel } from './output-channel.js';
import type { ServerManager } from './server-manager.js';
import { GitSnapshotProvider } from './git-snapshot-provider.js';
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
import type { GitBridgeDebugInfo } from '../../src/shared/diagnostics.js';
import { snapshotSignature, type GitWindowSnapshotResult } from '../../src/shared/git-snapshot.js';
import { resolveWorkspaceIdentity } from '../../src/shared/workspace-identity.js';
import type { GitLocalStatusSummary } from './git-status-display.js';

export class GitStateBridge implements vscode.Disposable {
  private readonly context: vscode.ExtensionContext;
  private readonly outputChannel: UnifiedOutputChannel;
  private readonly serverManager: ServerManager;
  private readonly snapshotProvider: GitSnapshotProvider;
  private readonly onDidChangeLocalGitStatusEmitter = new vscode.EventEmitter<void>();
  private requestWatcher: FSWatcher | null = null;
  private lastRequestId = '';
  private lastWrittenGitStatus = '';
  private lastPushedSignature = '';
  private lastLocalSnapshot: GitWindowSnapshotResult | null = null;
  private extensionVersion: string;
  private extensionInstanceId: string;
  private disposed = false;

  readonly onDidChangeLocalGitStatus = this.onDidChangeLocalGitStatusEmitter.event;

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

    this.snapshotProvider = new GitSnapshotProvider(outputChannel, {
      resolveWindowKey: () => this.resolveWindowKey(),
      resolveRepoLabel: () => this.resolveRepoLabel(),
      resolveWorkspaceFolderPath: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
    });
  }

  start(): void {
    const dataDir = this.context.globalStorageUri.fsPath;
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    this.snapshotProvider.onDidChangeSnapshot(snapshot => {
      void this.pushFromSnapshot(snapshot);
    });

    this.serverManager.on('stateChanged', () => {
      void this.handleOpenSourceControlRequest();
    });
    this.serverManager.on('started', () => {
      this.lastWrittenGitStatus = '';
      this.lastPushedSignature = '';
      this.snapshotProvider.emitCurrentSnapshot('server-started');
    });

    void this.snapshotProvider.start();
    void this.handleOpenSourceControlRequest();

    try {
      this.requestWatcher = watch(dataDir, (_eventType, filename) => {
        if (filename !== 'open-source-control-request.json') return;
        void this.handleOpenSourceControlRequest();
      });
    } catch (err) {
      this.outputChannel.warn(`[git-bridge] Failed to watch ${dataDir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  explicitRefreshGitStatus(): Promise<void> {
    return this.snapshotProvider.explicitRefresh('explicit-refresh');
  }

  getLocalGitStatus(): GitLocalStatusSummary | null {
    const diagnostics = this.snapshotProvider.getDiagnostics();
    if (!this.lastLocalSnapshot && diagnostics.gitLastSnapshotReason == null) {
      return null;
    }

    return {
      available: this.lastLocalSnapshot?.available ?? false,
      changedCount: this.lastLocalSnapshot?.changedCount ?? 0,
      repoLabel: this.lastLocalSnapshot?.available ? this.lastLocalSnapshot.repoLabel : undefined,
      error: diagnostics.lastError,
      reason: this.lastLocalSnapshot?.reason ?? diagnostics.gitLastSnapshotReason,
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.requestWatcher) {
      this.requestWatcher.close();
      this.requestWatcher = null;
    }
    this.snapshotProvider.dispose();
    this.onDidChangeLocalGitStatusEmitter.dispose();
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

  private resolveRepoLabel(): string | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder?.name || undefined;
  }

  private async pushFromSnapshot(snapshot: GitWindowSnapshotResult): Promise<void> {
    if (this.disposed) return;

    this.lastLocalSnapshot = snapshot;
    this.onDidChangeLocalGitStatusEmitter.fire();

    const windowName = vscode.workspace.name
      ?? vscode.workspace.workspaceFolders?.[0]?.name
      ?? 'unknown';
    const providerDiagnostics = this.snapshotProvider.getDiagnostics();
    const debugBase: GitBridgeDebugInfo = {
      updatedAt: snapshot.updatedAt,
      extensionVersion: this.extensionVersion,
      windowName,
      windowKey: snapshot.windowKey,
      isOwner: this.serverManager.isOwner,
      gitApiAvailable: providerDiagnostics.gitApiAvailable,
      repoCount: providerDiagnostics.gitRepositoryCount,
      repoResolved: providerDiagnostics.repoResolved,
      repoLabel: snapshot.available ? snapshot.repoLabel : undefined,
      changedCount: snapshot.changedCount,
      repoBreakdown: snapshot.repoBreakdown,
      gitProviderMode: 'vscode.git.state-cache',
      gitRepositoryCount: providerDiagnostics.gitRepositoryCount,
      gitLastSnapshotAt: providerDiagnostics.gitLastSnapshotAt ?? snapshot.updatedAt,
      gitLastSnapshotReason: snapshot.reason,
      gitExplicitRefreshCount: providerDiagnostics.gitExplicitRefreshCount,
      lastError: providerDiagnostics.lastError,
    };

    const gitStatus: GitStatusInfo = {
      available: snapshot.available,
      changedCount: snapshot.changedCount,
      repoLabel: snapshot.available ? snapshot.repoLabel : undefined,
      updatedAt: snapshot.updatedAt,
      source: 'vscode.git',
      windowKey: snapshot.windowKey,
    };

    await this.pushGitSnapshot(gitStatus, snapshot.windowKey, debugBase, snapshot.repoBreakdown);
  }

  private async pushGitSnapshot(
    gitStatus: GitStatusInfo,
    windowKey: string,
    debugBase: GitBridgeDebugInfo,
    repoBreakdown?: GitBridgeDebugInfo['repoBreakdown'],
  ): Promise<void> {
    const pushPayload: GitSnapshotPushPayload = {
      windowKey,
      gitStatus,
      repoBreakdown,
      updatedAt: gitStatus.updatedAt,
      extensionInstanceId: this.extensionInstanceId,
    };

    const signature = snapshotSignature({
      windowKey,
      available: gitStatus.available,
      changedCount: gitStatus.changedCount,
      repoLabel: gitStatus.repoLabel,
      repoBreakdown: repoBreakdown ?? [],
      repoSnapshots: [],
      updatedAt: gitStatus.updatedAt,
      reason: debugBase.gitLastSnapshotReason ?? 'initial',
    });

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
