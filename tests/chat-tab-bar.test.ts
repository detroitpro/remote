import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act } from 'react';
import type { ChatTab } from '../src/server/types.js';
import { ChatTabBar } from '../src/client/components/shell/ChatTabBar.js';
import { createComponentTestEnv } from './helpers/component-test-env.js';

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

describe('ChatTabBar component', () => {
  let env: ReturnType<typeof createComponentTestEnv>;

  beforeEach(() => {
    env = createComponentTestEnv();
  });

  afterEach(() => env.cleanup());

  it('hides tab bar when only one visible tab exists', () => {
    env.render(React.createElement(ChatTabBar, {
      tabs: [tab({ source: 'open', title: 'Only chat' })],
    }));

    const bar = env.document.getElementById('tab-bar')!;
    assert.ok(bar.classList.contains('hidden'));
  });

  it('renders Open and List groups without duplicate sidebar tabs', () => {
    env.render(React.createElement(ChatTabBar, {
      tabs: [
        tab({ source: 'open', composerId: 'c-open', title: 'Open chat', isActive: true }),
        tab({ source: 'sidebar', composerId: 'c-open', title: 'Open chat duplicate' }),
        tab({ source: 'sidebar', composerId: 'c-list', title: 'Sidebar only' }),
      ],
    }));

    const bar = env.document.getElementById('tab-bar')!;
    assert.ok(!bar.classList.contains('hidden'));
    const labels = Array.from(bar.querySelectorAll('.tab-group-label')).map(el => el.textContent);
    assert.deepEqual(labels, ['Open', 'List']);
    const titles = Array.from(bar.querySelectorAll('.tab-title')).map(el => el.textContent);
    assert.deepEqual(titles, ['Open chat', 'Sidebar only']);
  });

  it('emits switch_tab when a tab chip is clicked', () => {
    env.render(React.createElement(ChatTabBar, {
      tabs: [
        tab({ source: 'open', composerId: 'c1', title: 'First' }),
        tab({ source: 'open', composerId: 'c2', title: 'Second' }),
      ],
    }));

    const tabButtons = env.document.querySelectorAll('.tab-item');
    act(() => (tabButtons[1] as HTMLButtonElement).click());

    const sent = env.command.emitted.find(item => item.event === 'command:switch_tab');
    assert.ok(sent);
    assert.equal(sent.payload.composerId, 'c2');
  });
});
