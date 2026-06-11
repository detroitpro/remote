import assert from 'node:assert/strict';
import test from 'node:test';
import { devPackageVersion, parseBaseSemver, versionForFilename } from '../scripts/version-utils.js';

test('parseBaseSemver strips local and build metadata', () => {
  assert.deepEqual(parseBaseSemver('0.1.46-local'), { major: 0, minor: 1, patch: 46, base: '0.1.46' });
  assert.deepEqual(parseBaseSemver('0.1.46+abc1234'), { major: 0, minor: 1, patch: 46, base: '0.1.46' });
});

test('devPackageVersion appends git build id', () => {
  const version = devPackageVersion('0.1.46-local');
  assert.match(version, /^0\.1\.46\+[0-9a-f]+(?:\.dirty)?$/);
  assert.equal(versionForFilename(version).includes('+'), false);
});
