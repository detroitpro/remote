import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { CommandExecutor } from '../src/server/command-executor.js';
import type { SelectorConfig } from '../src/server/types.js';

function loadSelectors(): SelectorConfig {
  return JSON.parse(readFileSync(resolve('selectors.json'), 'utf-8')) as SelectorConfig;
}

function createExecutor(document: Document): CommandExecutor {
  const executor = new CommandExecutor(loadSelectors());
  executor.setClient({
    isConnected: () => true,
    evaluate: async (expression: string) => vm.runInNewContext(expression, { document, Array }),
  } as any);
  return executor;
}

describe('CommandExecutor.newChat', () => {
  it('clicks the plus button when the toolbar control is present', async () => {
    const dom = new JSDOM(`
      <button data-command-id="composer.createNewComposerTab" id="new-chat-plus">+</button>
    `);
    let clicked = false;
    dom.window.document.getElementById('new-chat-plus')!.addEventListener('click', () => {
      clicked = true;
    });

    const executor = createExecutor(dom.window.document);
    const result = await executor.newChat('cmd-plus');

    assert.equal(result.ok, true, result.error);
    assert.equal(clicked, true);
  });

  it('falls back to the sidebar New Agent action when the plus button is missing', async () => {
    const dom = new JSDOM(`
      <div id="workbench.parts.unifiedsidebar">
        <div><div><div><div><div>
          <div class="agent-sidebar-header">
            <div class="agent-sidebar-header-actions">
              <div id="new-agent-action">
                <div class="agent-sidebar-cell" draggable="false" data-selected="false">
                  <div class="agent-sidebar-cell-leading">
                    <div class="agent-sidebar-cell-content-wrapper">
                      <div class="agent-sidebar-cell-content">
                        <span class="agent-sidebar-cell-text">New Agent</span>
                      </div>
                    </div>
                  </div>
                  <div class="agent-sidebar-cell-trailing">
                    <span class="agent-sidebar-cell-trailing-caption">Ctrl+N</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div></div></div></div></div>
      </div>
    `);
    let clicked = false;
    dom.window.document.getElementById('new-agent-action')!.addEventListener('click', () => {
      clicked = true;
    });

    const executor = createExecutor(dom.window.document);
    const result = await executor.newChat('cmd-fallback');

    assert.equal(result.ok, true, result.error);
    assert.equal(clicked, true);
  });
});
