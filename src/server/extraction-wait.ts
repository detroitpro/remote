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
