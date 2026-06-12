import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildChatTabGroups } from '../src/client/view-models/chatTabs.js';
import type { ChatTab } from '../src/server/types.js';

function tab(overrides: Partial<ChatTab>): ChatTab {
  return {
    composerId: 'composer-1',
    title: 'Chat One',
    isActive: false,
    status: '',
    selectorPath: '#tab-1',
    source: 'open',
    workStatus: 'idle',
    ...overrides,
  };
}

describe('buildChatTabGroups', () => {
  it('keeps open tabs in the open group', () => {
    const groups = buildChatTabGroups([
      tab({ source: 'open', composerId: 'c1', title: 'Open chat' }),
    ]);

    assert.equal(groups.openTabs.length, 1);
    assert.equal(groups.listTabs.length, 0);
    assert.equal(groups.openTabs[0].title, 'Open chat');
  });

  it('filters list tabs that are already present in open tabs by composerId', () => {
    const groups = buildChatTabGroups([
      tab({ source: 'open', composerId: 'same-id', title: 'Feature work' }),
      tab({ source: 'sidebar', composerId: 'same-id', title: 'Feature work' }),
      tab({ source: 'sidebar', composerId: 'other-id', title: 'Other work' }),
    ]);

    assert.equal(groups.openTabs.length, 1);
    assert.equal(groups.listTabs.length, 1);
    assert.equal(groups.listTabs[0].composerId, 'other-id');
  });

  it('falls back to normalized title when sidebar item has no reliable composerId', () => {
    const groups = buildChatTabGroups([
      tab({ source: 'open', composerId: 'open-id', title: 'Agent Plan' }),
      tab({ source: 'sidebar', composerId: '', title: '  Agent Plan  ' }),
      tab({ source: 'sidebar', composerId: '', title: 'Another Chat' }),
    ]);

    assert.equal(groups.openTabs.length, 1);
    assert.equal(groups.listTabs.length, 1);
    assert.equal(groups.listTabs[0].title, 'Another Chat');
  });
});
