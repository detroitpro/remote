import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWorkspaceIdentity } from '../src/shared/workspace-identity.js';

test('resolveWorkspaceIdentity uses folder basename and remote qualifier', () => {
  assert.equal(
    resolveWorkspaceIdentity({
      workspacePath: 'R:/External/cursor-ide-remote',
      includeQualifier: false,
    }),
    'cursor-ide-remote',
  );

  assert.equal(
    resolveWorkspaceIdentity({
      workspacePath: '/home/user/other-repo',
      authority: 'wsl+Ubuntu',
      includeQualifier: true,
    }),
    'other-repo [WSL: Ubuntu]',
  );
});
