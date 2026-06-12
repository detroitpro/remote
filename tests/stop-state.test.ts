import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildStopButtonState, getRealStopAvailability } from '../src/client/view-models/stopState.js';
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
    activeComposerId: '',
    mode: { current: 'agent', available: [] },
    model: { current: 'Auto', currentId: '' },
    windows: [],
    activeWindowId: '',
    composerQueue: { items: [] },
    questionnaire: null,
    backgroundTasks: [],
    gitStatus: null,
    agentStopSelectorPath: '',
    agentStopAvailable: false,
    agentStopSource: 'none',
    exploratoryUi: null,
    ...overrides,
  };
}

describe('stop state view model', () => {
  it('treats composer stop selector as real stop availability even when agent status is idle', () => {
    const state = baseState({
      agentStatus: 'idle',
      agentStopSelectorPath: '#stop-agent',
      agentStopAvailable: true,
      agentStopSource: 'composer',
    });

    const availability = getRealStopAvailability(state);
    const viewModel = buildStopButtonState({
      state,
      sendPending: false,
      stopPending: false,
      lastKnownStopSelectorPath: '',
    });

    assert.equal(availability.available, true);
    assert.equal(availability.source, 'composer');
    assert.equal(viewModel.stopEnabled, true);
    assert.equal(viewModel.realStopAvailable, true);
  });

  it('does not treat background tasks without stopSelectorPath as stoppable work', () => {
    const state = baseState({
      backgroundTasks: [{ id: 'bg-1', label: 'npm run dev' }],
      agentStopAvailable: false,
      agentStopSource: 'none',
    exploratoryUi: null,
    });

    const availability = getRealStopAvailability(state);
    const viewModel = buildStopButtonState({
      state,
      sendPending: false,
      stopPending: false,
      lastKnownStopSelectorPath: '',
    });

    assert.equal(availability.available, false);
    assert.equal(viewModel.realStopAvailable, false);
    assert.equal(viewModel.stopEnabled, false);
  });

  it('treats background task stop selector as stoppable work', () => {
    const state = baseState({
      backgroundTasks: [{ id: 'bg-1', label: 'npm run dev', stopSelectorPath: '#stop-bg' }],
      agentStopAvailable: true,
      agentStopSource: 'background_task',
    });

    const availability = getRealStopAvailability(state);
    const viewModel = buildStopButtonState({
      state,
      sendPending: false,
      stopPending: false,
      lastKnownStopSelectorPath: '',
    });

    assert.equal(availability.available, true);
    assert.equal(availability.source, 'background_task');
    assert.equal(viewModel.stopEnabled, true);
    assert.equal(viewModel.effectiveStopSelectorPath, '#stop-bg');
  });

  it('keeps stop optimistically enabled right after submit before first extraction', () => {
    const state = baseState();
    const viewModel = buildStopButtonState({
      state,
      sendPending: true,
      stopPending: false,
      lastKnownStopSelectorPath: '',
    });

    assert.equal(viewModel.realStopAvailable, false);
    assert.equal(viewModel.stopEnabled, true);
    assert.match(viewModel.effectiveStopSelectorPath, /data-stop-button|codicon-debug-stop/);
  });

  it('disables stop once real selector is gone and optimistic phase finished', () => {
    const state = baseState({
      agentStatus: 'idle',
      agentActivityLive: false,
      agentStopSelectorPath: '',
      agentStopAvailable: false,
      agentStopSource: 'none',
    exploratoryUi: null,
    });

    const viewModel = buildStopButtonState({
      state,
      sendPending: false,
      stopPending: false,
      lastKnownStopSelectorPath: '',
    });

    assert.equal(viewModel.stopEnabled, false);
    assert.equal(viewModel.effectiveStopSelectorPath, '');
  });
});
