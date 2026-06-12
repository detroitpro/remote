import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { ExploratoryChrome } from '../src/client/components/exploratory/ExploratoryChrome.js';
import { createComponentTestEnv } from './helpers/component-test-env.js';

describe('ExploratoryChrome component', () => {
  let env: ReturnType<typeof createComponentTestEnv>;

  beforeEach(() => {
    env = createComponentTestEnv();
  });

  afterEach(() => env.cleanup());

  it('renders nothing when exploratoryUi is null', () => {
    env.render(React.createElement(ExploratoryChrome, { chrome: null }));
    assert.equal(env.document.getElementById('exploratory-chrome'), null);
  });

  it('renders sticky title and subagent trays when present', () => {
    env.render(React.createElement(ExploratoryChrome, {
      chrome: {
        stickyTitle: 'Implement feature X',
        cloudWidgets: [{ id: 'cw1', label: 'Cloud run' }],
        subagentTrays: [{ id: 'sa1', label: 'Research agent', status: 'running' }],
      },
    }));

    assert.ok(env.document.getElementById('exploratory-chrome'));
    assert.equal(env.document.getElementById('sticky-title-bar')?.textContent, 'Implement feature X');
    assert.ok(env.document.querySelector('.cloud-widget-chip'));
    assert.ok(env.document.querySelector('.subagent-tray-item'));
  });
});
