import type { CursorState } from '../../server/types.js';

export const OPTIMISTIC_STOP_SELECTOR = '[data-stop-button="true"], .composer-button-area .codicon-debug-stop, .send-with-mode .codicon-debug-stop';

export interface RealStopAvailability {
  available: boolean;
  selectorPath: string;
  source: CursorState['agentStopSource'];
}

export interface StopButtonState {
  realStopAvailable: boolean;
  hasActiveWork: boolean;
  stopEnabled: boolean;
  effectiveStopSelectorPath: string;
  source: CursorState['agentStopSource'];
}

function firstBackgroundStopSelector(state: CursorState): string {
  return state.backgroundTasks?.find(task => task.stopSelectorPath)?.stopSelectorPath ?? '';
}

export function getRealStopAvailability(state: CursorState): RealStopAvailability {
  const composerSelector = (state.agentStopSelectorPath || '').trim();
  const backgroundSelector = firstBackgroundStopSelector(state).trim();
  const selectorPath = composerSelector || backgroundSelector;
  const source = composerSelector
    ? 'composer'
    : (backgroundSelector ? 'background_task' : 'none');
  const available = !!selectorPath
    || !!state.agentStopAvailable
    || state.agentStopSource === 'composer'
    || state.agentStopSource === 'background_task';

  return {
    available,
    selectorPath,
    source,
  };
}

export function buildStopButtonState({
  state,
  sendPending,
  stopPending,
  lastKnownStopSelectorPath,
}: {
  state: CursorState;
  sendPending: boolean;
  stopPending: boolean;
  lastKnownStopSelectorPath: string;
}): StopButtonState {
  const availability = getRealStopAvailability(state);
  const effectiveStopSelectorPath = availability.selectorPath
    || (sendPending ? (lastKnownStopSelectorPath || OPTIMISTIC_STOP_SELECTOR) : '');
  const hasActiveWork = availability.available
    || sendPending
    || stopPending
    || state.agentActivityLive
    || state.agentStatus !== 'idle';

  return {
    realStopAvailable: availability.available,
    hasActiveWork,
    stopEnabled: !stopPending && !!effectiveStopSelectorPath && (availability.available || sendPending),
    effectiveStopSelectorPath,
    source: availability.source,
  };
}
