import * as vscode from 'vscode';
import type { UnifiedOutputChannel } from './output-channel.js';
import type { GitSnapshotReason } from '../../src/shared/diagnostics.js';
import {
  buildUnavailableWindowSnapshot,
  buildWindowSnapshot,
  createDebouncedCallback,
  resolveRepositories,
  snapshotSignature,
  type GitRepoLike,
  type GitWindowSnapshotResult,
} from '../../src/shared/git-snapshot.js';

const SNAPSHOT_DEBOUNCE_MS = 750;

interface GitExtensionApi {
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
  onDidCloseRepository: vscode.Event<GitRepository>;
}

interface GitRepository {
  rootUri: vscode.Uri;
  status?(): Promise<void>;
  state: GitRepositoryState;
}

interface GitRepositoryState {
  HEAD?: {
    name?: string;
    ahead?: number;
    behind?: number;
    upstream?: {
      remote: string;
      name: string;
    };
  };
  workingTreeChanges: Array<{ uri: vscode.Uri; resourceUri?: vscode.Uri }>;
  indexChanges: Array<{ uri: vscode.Uri; resourceUri?: vscode.Uri }>;
  mergeChanges: Array<{ uri: vscode.Uri; resourceUri?: vscode.Uri }>;
  untrackedChanges?: Array<{ uri: vscode.Uri; resourceUri?: vscode.Uri }>;
  onDidChange: vscode.Event<void>;
}

export interface GitSnapshotProviderOptions {
  resolveWindowKey: () => string;
  resolveRepoLabel: () => string | undefined;
  resolveWorkspaceFolderPath: () => string | null;
}

export interface GitSnapshotProviderDiagnostics {
  gitApiAvailable: boolean;
  gitRepositoryCount: number;
  repoResolved: boolean;
  gitLastSnapshotAt: number | null;
  gitLastSnapshotReason: GitSnapshotReason | null;
  gitExplicitRefreshCount: number;
  lastError?: string;
}

export class GitSnapshotProvider implements vscode.Disposable {
  private readonly outputChannel: UnifiedOutputChannel;
  private readonly options: GitSnapshotProviderOptions;
  private readonly onDidChangeSnapshotEmitter = new vscode.EventEmitter<GitWindowSnapshotResult>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly repoListeners = new Map<string, vscode.Disposable>();
  private gitApi: GitExtensionApi | null = null;
  private trackedRepositories: GitRepository[] = [];
  private lastEmittedSignature = '';
  private explicitRefreshCount = 0;
  private explicitRefreshInFlight = false;
  private pendingReason: GitSnapshotReason = 'initial';
  private lastSnapshotAt: number | null = null;
  private lastSnapshotReason: GitSnapshotReason | null = null;
  private lastError: string | undefined;
  private disposed = false;
  private readonly debouncedEmit: ReturnType<typeof createDebouncedCallback>;

  readonly onDidChangeSnapshot = this.onDidChangeSnapshotEmitter.event;

  constructor(outputChannel: UnifiedOutputChannel, options: GitSnapshotProviderOptions) {
    this.outputChannel = outputChannel;
    this.options = options;
    this.debouncedEmit = createDebouncedCallback(
      () => this.emitCurrentSnapshot(this.pendingReason),
      SNAPSHOT_DEBOUNCE_MS,
    );
  }

  async start(): Promise<void> {
    this.gitApi = await this.getGitApi();
    if (!this.gitApi) {
      this.lastError = 'vscode.git unavailable';
      this.emitSnapshot(buildUnavailableWindowSnapshot(
        this.options.resolveWindowKey(),
        'initial',
      ));
      return;
    }

    this.disposables.push(
      this.gitApi.onDidOpenRepository(repo => {
        this.refreshTrackedRepositories('repo-open');
        this.ensureRepoListener(repo);
        this.scheduleSnapshot('repo-open');
      }),
      this.gitApi.onDidCloseRepository(() => {
        this.refreshTrackedRepositories('repo-close');
        this.scheduleSnapshot('repo-close');
      }),
    );

    this.refreshTrackedRepositories('initial');
    for (const repo of this.trackedRepositories) {
      this.ensureRepoListener(repo);
    }
    this.emitCurrentSnapshot('initial');
  }

  async explicitRefresh(reason: GitSnapshotReason = 'explicit-refresh'): Promise<void> {
    if (this.disposed) return;
    if (!this.gitApi) {
      this.emitSnapshot(buildUnavailableWindowSnapshot(
        this.options.resolveWindowKey(),
        reason,
      ));
      return;
    }

    this.explicitRefreshCount += 1;
    this.explicitRefreshInFlight = true;
    try {
      for (const repo of this.trackedRepositories) {
        await repo.status?.();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.outputChannel.warn(`[git-snapshot] explicit repo.status() failed: ${message}`);
      this.lastError = message;
    } finally {
      this.explicitRefreshInFlight = false;
    }

    this.debouncedEmit.cancel();
    this.emitCurrentSnapshot(reason);
  }

  emitCurrentSnapshot(reason: GitSnapshotReason): void {
    if (this.disposed) return;

    const windowKey = this.options.resolveWindowKey();
    if (!this.gitApi) {
      this.emitSnapshot(buildUnavailableWindowSnapshot(windowKey, reason));
      return;
    }

    this.refreshTrackedRepositories(reason);
    if (!this.trackedRepositories.length) {
      this.lastError = 'no repository for workspace';
      this.emitSnapshot(buildUnavailableWindowSnapshot(windowKey, reason));
      return;
    }

    this.lastError = undefined;
    const repoLikes = this.trackedRepositories.map(repo => this.toRepoLike(repo));
    const snapshot = buildWindowSnapshot(
      repoLikes,
      windowKey,
      this.options.resolveRepoLabel(),
      reason,
    );
    this.emitSnapshot(snapshot);
  }

  getDiagnostics(): GitSnapshotProviderDiagnostics {
    return {
      gitApiAvailable: this.gitApi != null,
      gitRepositoryCount: this.gitApi?.repositories.length ?? 0,
      repoResolved: this.trackedRepositories.length > 0,
      gitLastSnapshotAt: this.lastSnapshotAt,
      gitLastSnapshotReason: this.lastSnapshotReason,
      gitExplicitRefreshCount: this.explicitRefreshCount,
      lastError: this.lastError,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.debouncedEmit.cancel();
    for (const disposable of this.repoListeners.values()) {
      disposable.dispose();
    }
    this.repoListeners.clear();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.onDidChangeSnapshotEmitter.dispose();
  }

  private scheduleSnapshot(reason: GitSnapshotReason): void {
    if (this.disposed || this.explicitRefreshInFlight) return;
    this.pendingReason = reason;
    this.debouncedEmit.schedule();
  }

  private emitSnapshot(snapshot: GitWindowSnapshotResult): void {
    const signature = snapshotSignature(snapshot);
    if (signature === this.lastEmittedSignature) {
      return;
    }

    this.lastEmittedSignature = signature;
    this.lastSnapshotAt = snapshot.updatedAt;
    this.lastSnapshotReason = snapshot.reason;
    this.onDidChangeSnapshotEmitter.fire(snapshot);
  }

  private refreshTrackedRepositories(_reason: GitSnapshotReason): void {
    if (!this.gitApi) {
      this.trackedRepositories = [];
      this.syncRepoListeners([]);
      return;
    }

    const repoLikes = this.gitApi.repositories.map(repo => this.toRepoLike(repo));
    const resolved = resolveRepositories(repoLikes, this.options.resolveWorkspaceFolderPath());
    const resolvedUris = new Set(resolved.map(repo => repo.rootUri));
    this.trackedRepositories = this.gitApi.repositories.filter(
      repo => resolvedUris.has(repo.rootUri.toString()) || resolvedUris.has(repo.rootUri.fsPath),
    );
    this.syncRepoListeners(this.trackedRepositories);
  }

  private syncRepoListeners(repositories: GitRepository[]): void {
    const nextKeys = new Set(repositories.map(repo => repo.rootUri.toString()));

    for (const [key, disposable] of this.repoListeners) {
      if (nextKeys.has(key)) continue;
      disposable.dispose();
      this.repoListeners.delete(key);
    }

    for (const repo of repositories) {
      this.ensureRepoListener(repo);
    }
  }

  private ensureRepoListener(repo: GitRepository): void {
    const key = repo.rootUri.toString();
    if (this.repoListeners.has(key)) return;

    this.repoListeners.set(key, repo.state.onDidChange(() => {
      if (this.disposed || this.explicitRefreshInFlight) return;
      this.scheduleSnapshot('state-change');
    }));
  }

  private toRepoLike(repo: GitRepository): GitRepoLike {
    return {
      rootUri: repo.rootUri.toString(),
      state: repo.state,
    };
  }

  private async getGitApi(): Promise<GitExtensionApi | null> {
    try {
      const extension = vscode.extensions.getExtension('vscode.git');
      if (!extension) return null;
      const exports = extension.isActive ? extension.exports : await extension.activate();
      const api = exports?.getAPI?.(1) as GitExtensionApi | undefined;
      return api ?? null;
    } catch (err) {
      this.outputChannel.warn(
        `[git-snapshot] Failed to activate vscode.git: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
