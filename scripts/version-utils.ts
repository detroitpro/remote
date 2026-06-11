import { execSync } from 'child_process';

export function parseBaseSemver(version: string): { major: number; minor: number; patch: number; base: string } {
  const core = version.split(/[-+]/)[0];
  const [major, minor, patch] = core.split('.').map(Number);
  if ([major, minor, patch].some(Number.isNaN)) {
    throw new Error(`Invalid semver base in version "${version}"`);
  }
  return { major, minor, patch, base: core };
}

export function gitBuildId(): string {
  try {
    const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    const dirty = execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
    return dirty ? `${hash}.dirty` : hash;
  } catch {
    return 'nogit';
  }
}

/** Semver with build metadata, e.g. 0.1.46+abc1234 */
export function devPackageVersion(baseVersion: string): string {
  const { base } = parseBaseSemver(baseVersion);
  return `${base}+${gitBuildId()}`;
}

/** Safe for filenames on Windows (no +). */
export function versionForFilename(version: string): string {
  return version.replace(/\+/g, '-');
}
