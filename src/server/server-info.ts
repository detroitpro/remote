import { randomBytes } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export function getServerModuleDir(): string {
  if (typeof __dirname !== 'undefined') return __dirname;
  return dirname(fileURLToPath(import.meta.url));
}

function moduleDir(): string {
  return getServerModuleDir();
}

function loadPackageVersion(): string {
  const candidates = [
    process.env.PACKAGE_ROOT?.trim(),
    process.cwd(),
    join(moduleDir(), '..', '..'),
    join(moduleDir(), '..'),
  ].filter((value): value is string => !!value);

  for (const dir of candidates) {
    const path = join(dir, 'package.json');
    if (!existsSync(path)) continue;
    try {
      const pkg = JSON.parse(readFileSync(path, 'utf-8')) as { name?: string; version?: string };
      if (pkg.name === 'cursor-remote' && pkg.version) return pkg.version;
    } catch {
      // try next candidate
    }
  }
  return 'unknown';
}

export const SERVER_INSTANCE = {
  instanceId: randomBytes(4).toString('hex'),
  startedAt: Date.now(),
  pid: process.pid,
  version: loadPackageVersion(),
};
