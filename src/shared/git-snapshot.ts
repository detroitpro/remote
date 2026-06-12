import type { GitBridgeRepoDebugInfo, GitSnapshotReason } from './diagnostics.js';
import { buildGitScmSnapshot } from './git-file-list.js';
import type { GitScmSnapshot } from './git-scm.js';
import {
  countGitChanges,
  countGitChangesAcrossRepositories,
  type GitRepositoryStateLike,
} from './git-status-count.js';

export interface GitRepoLike {
  rootUri: string;
  state: GitRepositoryStateLike;
}

export interface GitRepoSnapshot extends GitBridgeRepoDebugInfo {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: number;
  changed: number;
  untracked: number;
  merge: number;
}

export interface GitWindowSnapshotData {
  available: boolean;
  changedCount: number;
  repoLabel?: string;
  windowKey: string;
  repoBreakdown: GitBridgeRepoDebugInfo[];
  repoSnapshots: GitRepoSnapshot[];
  gitScm: GitScmSnapshot | null;
  updatedAt: number;
  reason: GitSnapshotReason;
}

export interface UnavailableGitWindowSnapshotData {
  available: false;
  changedCount: 0;
  windowKey: string;
  repoBreakdown: [];
  repoSnapshots: [];
  gitScm: null;
  updatedAt: number;
  reason: GitSnapshotReason;
}

export type GitWindowSnapshotResult = GitWindowSnapshotData | UnavailableGitWindowSnapshotData;

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function toNormalizedFsPath(value: string): string {
  let path = value;
  if (path.startsWith('file://')) {
    path = decodeURIComponent(path.replace(/^file:\/\//, ''));
    if (/^\/[a-zA-Z]:/.test(path)) {
      path = path.slice(1);
    }
  }
  return normalizePath(path);
}

export function repoLabelFromRootUri(rootUri: string): string {
  const path = rootUri.replace(/^file:\/\//, '').split(/[?#]/)[0] ?? rootUri;
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

export function resolveRepositories(
  repositories: GitRepoLike[],
  workspaceFolderPath: string | null | undefined,
): GitRepoLike[] {
  if (!repositories.length) return [];
  if (!workspaceFolderPath) return [...repositories];

  const workspacePath = toNormalizedFsPath(workspaceFolderPath);
  const exactMatches = repositories.filter(
    repo => toNormalizedFsPath(repo.rootUri) === workspacePath,
  );
  if (exactMatches.length) return exactMatches;

  const nestedMatches = repositories.filter(repo => {
    const repoPath = toNormalizedFsPath(repo.rootUri);
    return workspacePath.startsWith(repoPath + '/');
  });
  return nestedMatches.length ? nestedMatches : [...repositories];
}

export function buildRepoSnapshotFromState(
  rootUri: string,
  label: string,
  state: GitRepositoryStateLike,
): GitRepoSnapshot {
  const head = state.HEAD;
  const branch = head?.name ?? null;
  const upstream = head?.upstream
    ? `${head.upstream.remote}/${head.upstream.name}`
    : null;
  const ahead = head?.ahead ?? 0;
  const behind = head?.behind ?? 0;
  const staged = state.indexChanges?.length ?? 0;
  const changed = state.workingTreeChanges?.length ?? 0;
  const untracked = state.untrackedChanges?.length ?? 0;
  const merge = state.mergeChanges?.length ?? 0;

  return {
    rootUri,
    label,
    changedCount: countGitChanges(state),
    branch,
    upstream,
    ahead,
    behind,
    staged,
    changed,
    untracked,
    merge,
  };
}

export function buildUnavailableWindowSnapshot(
  windowKey: string,
  reason: GitSnapshotReason,
  updatedAt = Date.now(),
): UnavailableGitWindowSnapshotData {
  return {
    available: false,
    changedCount: 0,
    windowKey,
    repoBreakdown: [],
    repoSnapshots: [],
    gitScm: null,
    updatedAt,
    reason,
  };
}

export function buildWindowSnapshot(
  repositories: GitRepoLike[],
  windowKey: string,
  repoLabel: string | undefined,
  reason: GitSnapshotReason,
  updatedAt = Date.now(),
): GitWindowSnapshotData {
  const repoSnapshots = repositories.map(repo => buildRepoSnapshotFromState(
    repo.rootUri,
    repoLabelFromRootUri(repo.rootUri),
    repo.state,
  ));
  const repoBreakdown: GitBridgeRepoDebugInfo[] = repoSnapshots.map(snapshot => ({
    rootUri: snapshot.rootUri,
    label: snapshot.label,
    changedCount: snapshot.changedCount,
    branch: snapshot.branch,
    upstream: snapshot.upstream,
    ahead: snapshot.ahead,
    behind: snapshot.behind,
    staged: snapshot.staged,
    changed: snapshot.changed,
    untracked: snapshot.untracked,
    merge: snapshot.merge,
  }));
  const changedCount = countGitChangesAcrossRepositories(repositories.map(repo => repo.state));
  const baseSignature = JSON.stringify({
    windowKey,
    available: true,
    changedCount,
    repoLabel,
    repoBreakdown,
  });
  const gitScm = buildGitScmSnapshot(repositories, windowKey, updatedAt, baseSignature);

  return {
    available: true,
    changedCount,
    repoLabel,
    windowKey,
    repoBreakdown,
    repoSnapshots,
    gitScm,
    updatedAt,
    reason,
  };
}

export function snapshotSignature(data: GitWindowSnapshotResult): string {
  return JSON.stringify({
    windowKey: data.windowKey,
    available: data.available,
    changedCount: data.changedCount,
    repoLabel: data.available ? data.repoLabel : undefined,
    repoBreakdown: data.repoBreakdown,
    files: data.available
      ? (data.gitScm?.files ?? []).map(file => `${file.fileId}:${file.status}:${file.bucket}`).sort()
      : [],
  });
}

export function createDebouncedCallback(
  callback: () => void,
  delayMs: number,
  schedule: typeof setTimeout = setTimeout,
  cancel: typeof clearTimeout = clearTimeout,
): { schedule: () => void; cancel: () => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule() {
      if (timer) cancel(timer);
      timer = schedule(() => {
        timer = null;
        callback();
      }, delayMs);
    },
    cancel() {
      if (timer) {
        cancel(timer);
        timer = null;
      }
    },
    flush() {
      if (!timer) return;
      cancel(timer);
      timer = null;
      callback();
    },
  };
}
