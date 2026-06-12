import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act } from 'react';
import { HeaderBar } from '../src/client/components/shell/HeaderBar.js';
import { baseCursorState, createComponentTestEnv } from './helpers/component-test-env.js';

describe('HeaderBar component', () => {
  let env: ReturnType<typeof createComponentTestEnv>;

  beforeEach(() => {
    env = createComponentTestEnv();
  });

  afterEach(() => env.cleanup());

  it('renders connected status and disables stop when idle without stop control', () => {
    env.render(React.createElement(HeaderBar, {
      state: baseCursorState(),
      socketConnected: true,
      serverHealth: null,
      sendPending: false,
    }));

    const dot = env.document.getElementById('connection-dot')!;
    const status = env.document.getElementById('agent-status-text')!;
    const stop = env.document.getElementById('btn-agent-stop') as HTMLButtonElement;
    assert.ok(dot.classList.contains('connected'));
    assert.match(status.textContent!, /Idle/i);
    assert.equal(stop.disabled, true);
  });

  it('enables stop and sends stop_agent when real stop is available', () => {
    env.render(React.createElement(HeaderBar, {
      state: baseCursorState({
        agentStopAvailable: true,
        agentStopSelectorPath: '#stop-agent',
        agentStopSource: 'composer',
      }),
      socketConnected: true,
      serverHealth: null,
      sendPending: false,
    }));

    const stop = env.document.getElementById('btn-agent-stop') as HTMLButtonElement;
    assert.equal(stop.disabled, false);
    act(() => stop.click());

    const sent = env.command.awaited.find(item => item.event === 'command:stop_agent');
    assert.ok(sent, 'Expected stop_agent via sendCommandAwaitResult');
  });

  it('enables stop from background task stop selector when agent is idle', () => {
    env.render(React.createElement(HeaderBar, {
      state: baseCursorState({
        backgroundTasks: [{ id: 'bg-1', label: 'npm run dev', stopSelectorPath: '#stop-bg' }],
        agentStopAvailable: true,
        agentStopSource: 'background_task',
      }),
      socketConnected: true,
      serverHealth: null,
      sendPending: false,
    }));

    const stop = env.document.getElementById('btn-agent-stop') as HTMLButtonElement;
    assert.equal(stop.disabled, false);
  });
});
