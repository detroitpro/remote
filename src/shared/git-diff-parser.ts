import type { GitDiffChunk, GitDiffLine, GitDiffSummary } from './git-scm.js';

function countLineStats(lines: GitDiffLine[]): { insertions: number; deletions: number } {
  let insertions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.kind === 'insert') insertions += 1;
    if (line.kind === 'delete') deletions += 1;
  }
  return { insertions, deletions };
}

function parseHunkHeader(line: string): {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
} | null {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!match) return null;
  return {
    oldStart: Number(match[1]),
    oldLines: Number(match[2] ?? '1'),
    newStart: Number(match[3]),
    newLines: Number(match[4] ?? '1'),
  };
}

export function buildNewFileUnifiedDiff(relativePath: string, content: string): string {
  const normalized = content.replace(/\r\n/g, '\n');
  const body = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  const lines = body.length === 0 ? [] : body.split('\n');
  const header = [
    `diff --git a/${relativePath} b/${relativePath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${relativePath}`,
    `@@ -0,0 +1,${Math.max(lines.length, 0)} @@`,
  ].join('\n');
  if (lines.length === 0) {
    return `${header}\n`;
  }
  return `${header}\n${lines.map(line => `+${line}`).join('\n')}`;
}

export function parseUnifiedDiff(diffText: string): GitDiffChunk[] {
  const lines = diffText.replace(/\r\n/g, '\n').split('\n');
  const chunks: GitDiffChunk[] = [];
  let currentLines: GitDiffLine[] = [];
  let header: ReturnType<typeof parseHunkHeader> = null;
  let oldLine = 0;
  let newLine = 0;
  let chunkIndex = 0;

  const flush = () => {
    if (!header || currentLines.length === 0) return;
    chunks.push({
      chunkId: `hunk:${chunkIndex}`,
      oldStart: header.oldStart,
      oldLines: header.oldLines,
      newStart: header.newStart,
      newLines: header.newLines,
      lines: currentLines,
    });
    chunkIndex += 1;
    currentLines = [];
    header = null;
  };

  for (const raw of lines) {
    if (raw.startsWith('@@')) {
      flush();
      header = parseHunkHeader(raw);
      if (header) {
        oldLine = header.oldStart;
        newLine = header.newStart;
      }
      continue;
    }
    if (!header) continue;

    const prefix = raw[0] ?? ' ';
    const text = raw.slice(1);
    if (prefix === '+') {
      currentLines.push({ kind: 'insert', oldNo: null, newNo: newLine, text });
      newLine += 1;
    } else if (prefix === '-') {
      currentLines.push({ kind: 'delete', oldNo: oldLine, newNo: null, text });
      oldLine += 1;
    } else if (prefix === ' ' || prefix === '\\') {
      currentLines.push({ kind: 'context', oldNo: oldLine, newNo: newLine, text });
      oldLine += 1;
      newLine += 1;
    }
  }
  flush();
  return chunks;
}

export function summarizeDiff(chunks: GitDiffChunk[]): GitDiffSummary {
  let insertions = 0;
  let deletions = 0;
  for (const chunk of chunks) {
    const stats = countLineStats(chunk.lines);
    insertions += stats.insertions;
    deletions += stats.deletions;
  }
  return {
    insertions,
    deletions,
    hunksTotal: chunks.length,
  };
}

export function paginateDiffChunks(
  chunks: GitDiffChunk[],
  hunkCursor: string | undefined,
  limit: number,
): { chunks: GitDiffChunk[]; nextHunkCursor: string | null; remainingHunks: number } {
  let startIndex = 0;
  if (hunkCursor) {
    const match = /^hunk:(\d+)$/.exec(hunkCursor);
    if (match) {
      startIndex = Number(match[1]) + 1;
    }
  }
  const slice = chunks.slice(startIndex, startIndex + limit);
  const nextIndex = startIndex + slice.length;
  const nextHunkCursor = nextIndex < chunks.length ? `hunk:${startIndex + slice.length - 1}` : null;
  return {
    chunks: slice,
    nextHunkCursor,
    remainingHunks: Math.max(0, chunks.length - nextIndex),
  };
}

export function languageFromPath(path: string): string {
  const name = path.split('/').pop() ?? path;
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'plaintext';
  const ext = name.slice(dot + 1).toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    css: 'css',
    html: 'html',
    py: 'python',
    rs: 'rust',
    go: 'go',
  };
  return map[ext] ?? ext;
}
