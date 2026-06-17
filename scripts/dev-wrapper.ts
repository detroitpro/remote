/**
 * Spawns tsx watch outside the watch process so Enter isn't intercepted as "restart".
 */
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
import { resolve } from 'path';

async function main(): Promise<void> {
  mkdirSync(resolve(process.cwd(), 'temp'), { recursive: true });
  mkdirSync(resolve(process.cwd(), 'data'), { recursive: true });
  const tsxBin = process.platform === 'win32' ? 'tsx.cmd' : 'tsx';
  const tsxPath = resolve(process.cwd(), 'node_modules', '.bin', tsxBin);
  const child = spawn(tsxPath, ['watch', '--exclude', './data/**', '--exclude', './temp/**', 'src/server/index.ts'], {
    stdio: 'inherit',
    cwd: process.cwd(),
    shell: process.platform === 'win32',
  });
  child.on('error', (err) => {
    console.error('[dev-wrapper] Failed to start:', err.message);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
}

main().catch((err) => {
  console.error('[dev-wrapper] Fatal:', err);
  process.exit(1);
});
