import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';
import { extractionFunction } from '../src/server/dom-extractor.js';

function withDom<T>(html: string, fn: () => T): T {
  const dom = new JSDOM(html);
  const previous = {
    document: (globalThis as any).document,
    Element: (globalThis as any).Element,
    HTMLElement: (globalThis as any).HTMLElement,
    Node: (globalThis as any).Node,
  };

  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
  Object.defineProperty(globalThis, 'Element', { value: dom.window.Element, configurable: true });
  Object.defineProperty(globalThis, 'HTMLElement', { value: dom.window.HTMLElement, configurable: true });
  Object.defineProperty(globalThis, 'Node', { value: dom.window.Node, configurable: true });

  try {
    return fn();
  } finally {
    Object.defineProperty(globalThis, 'document', { value: previous.document, configurable: true });
    Object.defineProperty(globalThis, 'Element', { value: previous.Element, configurable: true });
    Object.defineProperty(globalThis, 'HTMLElement', { value: previous.HTMLElement, configurable: true });
    Object.defineProperty(globalThis, 'Node', { value: previous.Node, configurable: true });
    dom.window.close();
  }
}

describe('dom extractor: background tasks', () => {
  it('uses Cursor composer stop control as the agent stop target', () => {
    let resolvedStopButton: Element | null = null;
    const state = withDom(`
      <div id="container">
        <div class="button-container composer-button-area">
          <div class="anysphere-icon-button">
            <span class="codicon codicon-paperclip"></span>
          </div>
          <div class="send-with-mode">
            <div
              class="anysphere-icon-button"
              data-variant="background"
              data-mode="agent"
              data-outlined="true"
              data-stop-button="true"
            >
              <span class="codicon codicon-debug-stop"></span>
            </div>
          </div>
        </div>
      </div>
    `, () => {
      const extracted = extractionFunction(
        ['#container'],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        []
      );
      if (extracted?.agentStopSelectorPath) {
        resolvedStopButton = document.querySelector(extracted.agentStopSelectorPath);
      }
      return extracted;
    });

    assert.ok(state);
    assert.equal(state.backgroundTasks.length, 0);
    assert.equal(resolvedStopButton?.getAttribute('data-stop-button'), 'true');
  });

  it('surfaces Cursor toolbar background terminal items', () => {
    const state = withDom(`
      <div id="container">
        <div id="composer-toolbar-section">
          <div class="composer-toolbar-background-job-item composer-toolbar-background-job-item-clickable">
            <div class="composer-toolbar-background-job-item-icon">
              <span class="codicon codicon-terminal composer-toolbar-background-job-shell-icon"></span>
            </div>
            <div class="composer-toolbar-background-job-item-text">Start visible sleep after restart</div>
            <div class="composer-toolbar-background-job-item-actions">
              <div data-click-ready="true" class="composer-toolbar-background-job-item-stop">
                <span>Stop</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `, () => extractionFunction(
      ['#container'],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      []
    ));

    assert.ok(state);
    assert.equal(state.backgroundTasks.length, 1);
    assert.equal(state.backgroundTasks[0].label, 'Start visible sleep after restart');
    assert.match(state.backgroundTasks[0].stopSelectorPath || '', /composer-toolbar-section/);
    assert.equal(state.agentStopSelectorPath, state.backgroundTasks[0].stopSelectorPath);
  });

  it('surfaces a stoppable running shell call inside the transcript', () => {
    const state = withDom(`
      <div id="container">
        <div data-flat-index="1">
          <div data-message-role="ai" data-message-kind="tool" data-message-id="m1" data-tool-status="loading">
            <div data-tool-call-id="tool-1" data-tool-status="loading">
              <div class="ui-shell-tool-call ui-shell-tool-call--with-stop">
                <div class="ui-tool-call-card">
                  <div class="ui-tool-call-card__header">
                    <span class="ui-shell-tool-call__description">Running command</span>
                    <button class="ui-icon-button ui-shell-tool-call__glass-stop" aria-label="Stop command"></button>
                  </div>
                  <div class="ui-shell-tool-call__command">Start-Sleep -Seconds 600</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `, () => extractionFunction(
      ['#container'],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      []
    ));

    assert.ok(state);
    assert.equal(state.backgroundTasks.length, 1);
    assert.equal(state.backgroundTasks[0].label, 'Start-Sleep -Seconds 600');
    assert.match(state.backgroundTasks[0].stopSelectorPath || '', /button/);
  });
});
