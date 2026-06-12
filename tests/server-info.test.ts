import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function baseVersion(version: string): string {
  return version.split(/[-+]/)[0] ?? version;
}

async function importFreshServerInfo() {
  const moduleUrl = pathToFileURL(resolve('src/server/server-info.ts')).href;
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

test('SERVER_INSTANCE.version appends git build id for local workspace package', async () => {
  const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as { version: string };
  const previousPackageRoot = process.env.PACKAGE_ROOT;
  process.env.PACKAGE_ROOT = resolve('.');

  try {
    const serverInfo = await importFreshServerInfo();
    assert.match(
      serverInfo.SERVER_INSTANCE.version,
      new RegExp(`^${baseVersion(pkg.version)}\\+[0-9a-f]+(?:\\.dirty)?$`),
    );
  } finally {
    if (previousPackageRoot === undefined) {
      delete process.env.PACKAGE_ROOT;
    } else {
      process.env.PACKAGE_ROOT = previousPackageRoot;
    }
  }
});
