import { createHash } from 'crypto';

function normalizeRootUri(rootUri: string): string {
  let path = rootUri;
  if (path.startsWith('file://')) {
    path = decodeURIComponent(path.replace(/^file:\/\//, ''));
    if (/^\/[a-zA-Z]:/.test(path)) {
      path = path.slice(1);
    }
  }
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function repoIdFromRootUri(rootUri: string): string {
  const normalized = normalizeRootUri(rootUri);
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 8);
  return `repo:${hash}`;
}

export function fileIdFromParts(repoId: string, bucket: string, path: string): string {
  return `${repoId}|${bucket}|${path}`;
}

export function parseFileId(fileId: string): { repoId: string; bucket: string; path: string } | null {
  const parts = fileId.split('|');
  if (parts.length < 3) return null;
  const repoId = parts[0] ?? '';
  const bucket = parts[1] ?? '';
  const path = parts.slice(2).join('|');
  if (!repoId || !bucket || !path) return null;
  return { repoId, bucket, path };
}

export function buildSnapshotId(windowKey: string, updatedAt: number, signature: string): string {
  const hash = createHash('sha256')
    .update(`${windowKey}:${updatedAt}:${signature}`)
    .digest('hex')
    .slice(0, 8);
  return `git:${windowKey}:${updatedAt}:${hash}`;
}
