import * as vscode from 'vscode';
import type { GitActionRequest, GitActionResult } from '../../src/shared/git-scm.js';
import type { GitDiffStageView } from '../../src/shared/git-scm.js';
import { repoIdFromRootUri } from '../../src/shared/git-repo-id.js';
import { resolveRepositories, type GitRepoLike } from '../../src/shared/git-snapshot.js';
import type { GitSnapshotProvider } from './git-snapshot-provider.js';

interface GitRepository {
  rootUri: vscode.Uri;
  add?(paths: string[]): Promise<void>;
  restore?(paths: string[], options?: { staged?: boolean }): Promise<void>;
  diffWithHEAD?(path: string): Promise<string>;
  diffIndexWithHEAD?(path: string): Promise<string>;
  state: {
    indexChanges: Array<{ uri: vscode.Uri }>;
    workingTreeChanges: Array<{ uri: vscode.Uri }>;
    untrackedChanges?: Array<{ uri: vscode.Uri }>;
    mergeChanges: Array<{ uri: vscode.Uri }>;
  };
}

interface GitExtensionApi {
  repositories: GitRepository[];
}

export class GitActionExecutor {
  constructor(
    private readonly snapshotProvider: GitSnapshotProvider,
    private readonly resolveWorkspaceFolderPath: () => string | null,
  ) {}

  async execute(request: GitActionRequest): Promise<GitActionResult> {
    const base: GitActionResult = {
      requestId: request.requestId,
      ok: false,
      completedAt: Date.now(),
    };

    try {
      switch (request.action) {
        case 'refresh':
          await this.snapshotProvider.explicitRefresh('explicit-refresh');
          return { ...base, ok: true };
        case 'diff':
          return await this.executeDiff(request, base);
        case 'stage':
          return await this.executeStage(request, base, true);
        case 'unstage':
          return await this.executeStage(request, base, false);
        default:
          return { ...base, error: `Unknown action: ${String((request as GitActionRequest).action)}` };
      }
    } catch (err) {
      return {
        ...base,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private resolveRepo(repoId: string): GitRepository | null {
    const gitApi = this.snapshotProvider.getGitApiSync();
    if (!gitApi) return null;

    const repoLikes: GitRepoLike[] = gitApi.repositories.map(repo => ({
      rootUri: repo.rootUri.toString(),
      state: repo.state,
    }));
    const resolved = resolveRepositories(repoLikes, this.resolveWorkspaceFolderPath());
    const resolvedUris = new Set(resolved.map(repo => repo.rootUri));
    const repositories = gitApi.repositories.filter(
      repo => resolvedUris.has(repo.rootUri.toString()) || resolvedUris.has(repo.rootUri.fsPath),
    );

    for (const repo of repositories) {
      if (repoIdFromRootUri(repo.rootUri.toString()) === repoId) {
        return repo;
      }
    }
    return null;
  }

  private normalizeRepoPath(path: string): string {
    return path.replace(/\\/g, '/');
  }

  private async executeDiff(
    request: GitActionRequest,
    base: GitActionResult,
  ): Promise<GitActionResult> {
    if (!request.repoId || !request.path) {
      return { ...base, error: 'Missing repoId or path' };
    }
    const repo = this.resolveRepo(request.repoId);
    if (!repo) {
      return { ...base, error: 'Repository not found' };
    }

    const relativePath = this.normalizeRepoPath(String(request.path));
    const stage: GitDiffStageView = request.stage === 'index' ? 'index' : 'working';
    let diffText = '';
    if (stage === 'index' && repo.diffIndexWithHEAD) {
      diffText = await repo.diffIndexWithHEAD(relativePath);
    } else if (repo.diffWithHEAD) {
      diffText = await repo.diffWithHEAD(relativePath);
    } else if (repo.diffIndexWithHEAD && stage === 'index') {
      diffText = await repo.diffIndexWithHEAD(relativePath);
    } else {
      return { ...base, error: 'Git diff API unavailable' };
    }

    const isBinary = diffText.startsWith('Binary files') || diffText.includes('GIT binary patch');
    return {
      ...base,
      ok: true,
      diffText,
      isBinary,
    };
  }

  private async executeStage(
    request: GitActionRequest,
    base: GitActionResult,
    stage: boolean,
  ): Promise<GitActionResult> {
    if (!request.repoId || !request.paths?.length) {
      return { ...base, error: 'Missing repoId or paths' };
    }
    const repo = this.resolveRepo(request.repoId);
    if (!repo) {
      return { ...base, error: 'Repository not found' };
    }

    const paths = request.paths.map(path => this.normalizeRepoPath(String(path)));

    if (stage) {
      if (!repo.add) {
        return { ...base, error: 'Git add API unavailable' };
      }
      await repo.add(paths);
    } else {
      if (!repo.restore) {
        return { ...base, error: 'Git restore API unavailable' };
      }
      await repo.restore(paths, { staged: true });
    }

    return {
      ...base,
      ok: true,
      affected: paths,
    };
  }
}
