import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFileListFromRepo,
  buildGitScmSnapshot,
  paginateFiles,
} from '../src/shared/git-file-list.js';
import { parseFileId } from '../src/shared/git-repo-id.js';
import { parseUnifiedDiff, summarizeDiff, buildNewFileUnifiedDiff } from '../src/shared/git-diff-parser.js';

test('buildFileListFromRepo maps buckets from git state', () => {
  const files = buildFileListFromRepo({
    rootUri: 'file:///workspace/repo',
    state: {
      indexChanges: [{ uri: { toString: () => 'file:///workspace/repo/staged.ts' }, status: 0 }],
      workingTreeChanges: [{ uri: { toString: () => 'file:///workspace/repo/changed.ts' }, status: 5 }],
      untrackedChanges: [{ uri: { toString: () => 'file:///workspace/repo/new.ts' }, status: 7 }],
      mergeChanges: [{ uri: { toString: () => 'file:///workspace/repo/conflict.ts' }, status: 16 }],
    },
  }, Date.now());

  assert.equal(files.length, 4);
  assert.ok(files.some(file => file.bucket === 'staged' && file.path === 'staged.ts' && file.status === 'M'));
  assert.ok(files.some(file => file.bucket === 'changes' && file.path === 'changed.ts' && file.status === 'M'));
  assert.ok(files.some(file => file.bucket === 'untracked' && file.path === 'new.ts' && file.status === 'U'));
  assert.ok(files.some(file => file.bucket === 'conflicts' && file.path === 'conflict.ts' && file.status === 'U'));
});

test('buildGitScmSnapshot includes repos and files', () => {
  const snapshot = buildGitScmSnapshot(
    [{
      rootUri: 'file:///workspace/repo',
      state: {
        HEAD: { name: 'feature/git' },
        indexChanges: [{ uri: { toString: () => 'file:///workspace/repo/a.ts' } }],
      },
    }],
    'workspace',
    1000,
    'sig',
  );

  assert.equal(snapshot.version, 2);
  assert.equal(snapshot.windowKey, 'workspace');
  assert.equal(snapshot.repos.length, 1);
  assert.equal(snapshot.repos[0]?.branch, 'feature/git');
  assert.equal(snapshot.files.length, 1);
});

test('paginateFiles returns cursor for next page', () => {
  const files = Array.from({ length: 3 }, (_, index) => ({
    fileId: `repo:abc|changes|file-${index}.ts`,
    repoId: 'repo:abc',
    bucket: 'changes' as const,
    path: `file-${index}.ts`,
    originalPath: null,
    displayPath: `file-${index}.ts`,
    status: 'MODIFIED',
    isRename: false,
    isBinary: false,
    isLarge: false,
    isConflict: false,
    updatedAt: 1,
  }));

  const first = paginateFiles(files, 'repo:abc', 'changes', 0, 2);
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor);
  const parsed = parseFileId(first.items[0]!.fileId);
  assert.equal(parsed?.path, 'file-0.ts');
});

test('buildFileListFromRepo keeps partially staged file in staged and changes buckets', () => {
  const files = buildFileListFromRepo({
    rootUri: 'file:///workspace/repo',
    state: {
      indexChanges: [{ uri: { toString: () => 'file:///workspace/repo/shared.ts' }, status: 0 }],
      workingTreeChanges: [{ uri: { toString: () => 'file:///workspace/repo/shared.ts' }, status: 5 }],
    },
  }, Date.now());

  assert.equal(files.length, 2);
  assert.ok(files.some(file => file.bucket === 'staged' && file.path === 'shared.ts'));
  assert.ok(files.some(file => file.bucket === 'changes' && file.path === 'shared.ts'));
});

test('buildFileListFromRepo prefers resourceUri and keeps repo-relative Windows path', () => {
  const files = buildFileListFromRepo({
    rootUri: 'file:///R%3A/External/cursor-ide-remote',
    state: {
      workingTreeChanges: [{
        uri: { toString: () => 'file:///C%3A/package.json', fsPath: 'C:\\package.json' },
        resourceUri: {
          toString: () => 'file:///R%3A/External/cursor-ide-remote/package.json',
          fsPath: 'R:\\External\\cursor-ide-remote\\package.json',
        },
        status: 5,
      }],
    },
  }, Date.now());

  assert.equal(files.length, 1);
  assert.equal(files[0]?.path, 'package.json');
  assert.equal(files[0]?.displayPath, 'package.json');
});

test('filterFilesByBuckets supports changes tab buckets', async () => {
  const { filterFilesByBuckets } = await import('../src/shared/git-file-list.js');
  const files = [
    { fileId: '1', repoId: 'r', bucket: 'staged' as const, path: 'a.ts' },
    { fileId: '2', repoId: 'r', bucket: 'changes' as const, path: 'b.ts' },
    { fileId: '3', repoId: 'r', bucket: 'untracked' as const, path: 'c.ts' },
    { fileId: '4', repoId: 'r', bucket: 'conflicts' as const, path: 'd.ts' },
  ].map(file => ({
    ...file,
    originalPath: null,
    displayPath: file.path,
    status: 'MODIFIED',
    isRename: false,
    isBinary: false,
    isLarge: false,
    isConflict: file.bucket === 'conflicts',
    updatedAt: 1,
  }));

  const filtered = filterFilesByBuckets(files, 'r', undefined, ['changes', 'untracked']);
  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered.map(file => file.path), ['b.ts', 'c.ts']);
});

test('resolveDiffStage prefers index for staged bucket', async () => {
  const { resolveDiffStage } = await import('../src/server/git/git-scm-service.js');
  const stagedFile = {
    fileId: 'f',
    repoId: 'r',
    bucket: 'staged' as const,
    path: 'a.ts',
    originalPath: null,
    displayPath: 'a.ts',
    status: 'INDEX_MODIFIED',
    isRename: false,
    isBinary: false,
    isLarge: false,
    isConflict: false,
    updatedAt: 1,
  };
  assert.equal(resolveDiffStage(stagedFile, 'working'), 'index');
  assert.equal(resolveDiffStage({ ...stagedFile, bucket: 'changes' }, 'working'), 'working');
});

test('buildNewFileUnifiedDiff parses as all insertions', () => {
  const diff = buildNewFileUnifiedDiff('src/new.ts', 'line one\nline two\n');
  const chunks = parseUnifiedDiff(diff);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.lines.length, 2);
  const summary = summarizeDiff(chunks);
  assert.equal(summary.insertions, 2);
  assert.equal(summary.deletions, 0);
});

test('parseUnifiedDiff splits hunks and counts stats', () => {
  const diff = [
    '--- a/file.ts',
    '+++ b/file.ts',
    '@@ -1,3 +1,4 @@',
    ' context',
    '-removed',
    '+added',
    ' context2',
  ].join('\n');

  const chunks = parseUnifiedDiff(diff);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.lines.length, 4);
  const summary = summarizeDiff(chunks);
  assert.equal(summary.insertions, 1);
  assert.equal(summary.deletions, 1);
  assert.equal(summary.hunksTotal, 1);
});
