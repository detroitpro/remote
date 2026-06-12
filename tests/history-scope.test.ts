import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getHistoryScopeKey } from '../src/shared/history-scope.js';
import type { CursorState } from '../src/server/types.js';

function baseState(): Pick<CursorState, 'activeWindowId' | 'activeComposerId' | 'chatTabs'> {
  return {
    activeWindowId: 'win-1',
    activeComposerId: 'composer-1',
    chatTabs: [{
      composerId: 'composer-1',
      title: 'First chat',
      isActive: true,
      status: 'active',
      selectorPath: '',
      source: 'open',
      workStatus: 'idle',
    }],
  };
}

describe('history-scope', () => {
  it('changes when active open tab title changes', () => {
    const before = getHistoryScopeKey(baseState());
    const after = getHistoryScopeKey({
      ...baseState(),
      chatTabs: [{
        ...baseState().chatTabs[0],
        title: 'Questionnaire toolbar',
      }],
    });
    assert.notEqual(before, after);
  });
});
