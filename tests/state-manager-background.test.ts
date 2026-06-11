import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StateManager } from '../src/server/state-manager.js';
import type { CursorState } from '../src/server/types.js';

function baseState(overrides: Partial<CursorState> = {}): CursorState {
  return {
    connected: true,
    extractorStatus: 'ok',
    lastExtractionAt: Date.now(),
    consecutiveExtractionFailures: 0,
    lastExtractionError: null,
    agentStatus: 'idle',
    agentActivityText: null,
    agentActivityLive: false,
    agentActivitySource: 'none',
    messages: [],
    pendingApprovals: [],
    inputAvailable: true,
    chatTabs: [],
    activeComposerId: 'composer-1',
    mode: { current: 'agent', available: [] },
    model: { current: 'Auto', currentId: '' },
    windows: [],
    activeWindowId: '',
    composerQueue: { items: [] },
    questionnaire: null,
    backgroundTasks: [],
    agentStopSelectorPath: '',
    ...overrides,
  };
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('state manager: background tasks', () => {
  it('emits patches when background tasks change', async () => {
    const manager = new StateManager(0);
    const patches: Partial<CursorState>[] = [];
    manager.on('state:patch', (patch) => patches.push(patch));

    manager.onExtraction(baseState());
    await nextTick();
    patches.length = 0;

    manager.onExtraction(baseState({
      backgroundTasks: [
        { id: 'background:1', label: 'Start-Sleep -Seconds 600', stopSelectorPath: '#stop-bg' },
      ],
      agentStopSelectorPath: '#stop-bg',
    }));
    await nextTick();

    assert.equal(patches.length, 1);
    assert.deepEqual(patches[0].backgroundTasks, [
      { id: 'background:1', label: 'Start-Sleep -Seconds 600', stopSelectorPath: '#stop-bg' },
    ]);
    assert.equal(patches[0].agentStopSelectorPath, '#stop-bg');
  });
});
