import type { StateManager } from './state-manager.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait until the DOM extractor bumps state generation after a CDP-side change. */
export async function waitForFreshExtraction(
  stateManager: StateManager,
  genBefore: number,
  maxWaitMs: number
): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  while (stateManager.generation <= genBefore && Date.now() < deadline) {
    await sleep(200);
  }
}

/** Wait until the active chat scope changes (tab/composer switch). */
export async function waitForHistoryScopeChange(
  stateManager: StateManager,
  scopeBefore: string,
  maxWaitMs: number,
): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (stateManager.historyScopeKey() !== scopeBefore) return true;
    await sleep(200);
  }
  return false;
}
