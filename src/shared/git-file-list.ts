import type { GitFileBucket, GitFileSummary, GitRepoSummary, GitScmSnapshot } from './git-scm.js';
import { GIT_SCM_VERSION } from './git-scm.js';
import { buildSnapshotId, fileIdFromParts, repoIdFromRootUri } from './git-repo-id.js';
import { buildRepoSnapshotFromState, repoLabelFromRootUri, type GitRepoLike } from './git-snapshot.js';
import type { GitRepositoryStateLike } from './git-status-count.js';

export interface GitChangeEntryLike {
  uri?: { toString(): string; fsPath?: string };
  resourceUri?: { toString(): string; fsPath?: string };
  originalUri?: { toString(): string; fsPath?: string };
  renameUri?: { toString(): string; fsPath?: string };
  status?: number;
}

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz',
  '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mp3', '.wasm', '.exe', '.dll',
]);

function uriToRelativePath(uri: string, rootUri: string): string {
  let filePath = uri;
  if (filePath.startsWith('file://')) {
    filePath = decodeURIComponent(filePath.replace(/^file:\/\//, ''));
    if (/^\/[a-zA-Z]:/.test(filePath)) {
      filePath = filePath.slice(1);
    }
  }

  let rootPath = rootUri;
  if (rootPath.startsWith('file://')) {
    rootPath = decodeURIComponent(rootPath.replace(/^file:\/\//, ''));
    if (/^\/[a-zA-Z]:/.test(rootPath)) {
      rootPath = rootPath.slice(1);
    }
  }

  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedFile = filePath.replace(/\\/g, '/');
  if (normalizedFile.startsWith(normalizedRoot + '/')) {
    return normalizedFile.slice(normalizedRoot.length + 1);
  }
  if (normalizedFile === normalizedRoot) {
    return normalizedFile.split('/').pop() ?? normalizedFile;
  }
  return normalizedFile.split('/').pop() ?? normalizedFile;
}

function statusLabel(status: number | undefined, bucket: GitFileBucket): string {
  if (status === undefined) {
    if (bucket === 'untracked') return 'U';
    if (bucket === 'conflicts') return 'U';
    if (bucket === 'staged') return 'M';
    return 'M';
  }
  const map: Record<number, string> = {
    0: 'M', // INDEX_MODIFIED
    1: 'A', // INDEX_ADDED
    2: 'D', // INDEX_DELETED
    3: 'R', // INDEX_RENAMED
    4: 'C', // INDEX_COPIED
    5: 'M', // MODIFIED
    6: 'D', // DELETED
    7: 'U', // UNTRACKED
    8: 'I', // IGNORED
    9: 'A', // INTENT_TO_ADD
    10: 'U', // ADDED_BY_US (unmerged)
    11: 'U', // ADDED_BY_THEM
    12: 'U', // DELETED_BY_US
    13: 'U', // DELETED_BY_THEM
    14: 'U', // BOTH_ADDED
    15: 'U', // BOTH_DELETED
    16: 'U', // BOTH_MODIFIED
  };
  return map[status] ?? '?';
}

function isBinaryPath(path: string): boolean {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return false;
  return BINARY_EXTENSIONS.has(lower.slice(dot));
}

function buildFileEntry(
  repoId: string,
  rootUri: string,
  bucket: GitFileBucket,
  change: GitChangeEntryLike,
  updatedAt: number,
): GitFileSummary {
  const primaryUri = change.uri ?? change.resourceUri;
  const uriStr = primaryUri?.toString() ?? '';
  const path = uriToRelativePath(uriStr, rootUri);
  const renameUri = change.renameUri ?? change.originalUri;
  const originalPath = renameUri
    ? uriToRelativePath(renameUri.toString(), rootUri)
    : null;
  const isRename = originalPath != null && originalPath !== path;
  const displayPath = isRename ? `${originalPath} → ${path}` : path;
  const status = statusLabel(change.status, bucket);

  return {
    fileId: fileIdFromParts(repoId, bucket, path),
    repoId,
    bucket,
    path,
    originalPath,
    displayPath,
    status,
    isRename,
    isBinary: isBinaryPath(path),
    isLarge: false,
    isConflict: bucket === 'conflicts',
    updatedAt,
  };
}

function collectChanges(
  repoId: string,
  rootUri: string,
  bucket: GitFileBucket,
  changes: GitChangeEntryLike[] | undefined,
  updatedAt: number,
): GitFileSummary[] {
  if (!changes?.length) return [];
  return changes.map(change => buildFileEntry(repoId, rootUri, bucket, change, updatedAt));
}

export function buildFileListFromRepo(
  repo: GitRepoLike,
  updatedAt: number,
): GitFileSummary[] {
  const repoId = repoIdFromRootUri(repo.rootUri);
  const state = repo.state as GitRepositoryStateLike & {
    indexChanges?: GitChangeEntryLike[];
    workingTreeChanges?: GitChangeEntryLike[];
    untrackedChanges?: GitChangeEntryLike[];
    mergeChanges?: GitChangeEntryLike[];
  };

  const staged = collectChanges(repoId, repo.rootUri, 'staged', state.indexChanges, updatedAt);
  const working = collectChanges(repoId, repo.rootUri, 'changes', state.workingTreeChanges, updatedAt);
  const untracked = collectChanges(repoId, repo.rootUri, 'untracked', state.untrackedChanges, updatedAt);
  const conflicts = collectChanges(repoId, repo.rootUri, 'conflicts', state.mergeChanges, updatedAt);

  // Keep separate entries per bucket so partially staged files appear in both Staged and Changes.
  const seen = new Set<string>();
  const merged: GitFileSummary[] = [];
  for (const file of [...staged, ...working, ...untracked, ...conflicts]) {
    if (seen.has(file.fileId)) continue;
    seen.add(file.fileId);
    merged.push(file);
  }
  return merged;
}

export function buildRepoSummaries(
  repositories: GitRepoLike[],
  updatedAt: number,
): GitRepoSummary[] {
  return repositories.map(repo => {
    const snapshot = buildRepoSnapshotFromState(
      repo.rootUri,
      repoLabelFromRootUri(repo.rootUri),
      repo.state,
    );
    const repoId = repoIdFromRootUri(repo.rootUri);
    return {
      repoId,
      rootUri: repo.rootUri,
      label: snapshot.label,
      branch: snapshot.branch,
      ahead: snapshot.ahead,
      behind: snapshot.behind,
      counts: {
        staged: snapshot.staged,
        changes: snapshot.changed,
        conflicts: snapshot.merge,
        untracked: snapshot.untracked,
      },
    };
  });
}

export function buildGitScmSnapshot(
  repositories: GitRepoLike[],
  windowKey: string,
  updatedAt: number,
  signature: string,
): GitScmSnapshot {
  const repos = buildRepoSummaries(repositories, updatedAt);
  const files = repositories.flatMap(repo => buildFileListFromRepo(repo, updatedAt));
  return {
    version: GIT_SCM_VERSION,
    snapshotId: buildSnapshotId(windowKey, updatedAt, signature),
    updatedAt,
    windowKey,
    repos,
    files,
  };
}

export function filterFilesByBuckets(
  files: GitFileSummary[],
  repoId: string | undefined,
  bucket: GitFileBucket | undefined,
  buckets: GitFileBucket[] | undefined,
): GitFileSummary[] {
  let filtered = files;
  if (repoId) {
    filtered = filtered.filter(file => file.repoId === repoId);
  }
  if (buckets?.length) {
    const allowed = new Set(buckets);
    filtered = filtered.filter(file => allowed.has(file.bucket));
  } else if (bucket) {
    filtered = filtered.filter(file => file.bucket === bucket);
  }
  return filtered;
}

export function paginateFiles(
  files: GitFileSummary[],
  repoId: string | undefined,
  bucket: GitFileBucket | undefined,
  offset: number,
  limit: number,
  buckets?: GitFileBucket[],
): { items: GitFileSummary[]; nextCursor: string | null; total: number } {
  const filtered = filterFilesByBuckets(files, repoId, bucket, buckets);
  const slice = filtered.slice(offset, offset + limit);
  const nextOffset = offset + slice.length;
  const nextCursor = nextOffset < filtered.length
    ? Buffer.from(JSON.stringify({ offset: nextOffset, repoId, bucket, buckets }), 'utf-8').toString('base64url')
    : null;
  return { items: slice, nextCursor, total: filtered.length };
}

export function decodeFileListCursor(cursor: string): {
  offset: number;
  repoId?: string;
  bucket?: GitFileBucket;
  buckets?: GitFileBucket[];
} | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8')) as {
      offset?: number;
      repoId?: string;
      bucket?: GitFileBucket;
      buckets?: GitFileBucket[];
    };
    if (typeof parsed.offset !== 'number' || parsed.offset < 0) return null;
    return {
      offset: parsed.offset,
      repoId: parsed.repoId,
      bucket: parsed.bucket,
      buckets: parsed.buckets,
    };
  } catch {
    return null;
  }
}

export function findFileInSnapshot(
  snapshot: GitScmSnapshot,
  fileId: string,
): GitFileSummary | undefined {
  return snapshot.files.find(file => file.fileId === fileId);
}
