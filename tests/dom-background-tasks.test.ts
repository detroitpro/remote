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
    let resolvedStopButtonAttr: string | null = null;
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
        resolvedStopButtonAttr = document
          .querySelector(extracted.agentStopSelectorPath)
          ?.getAttribute('data-stop-button') ?? null;
      }
      return extracted;
    });

    assert.ok(state);
    assert.equal(state.backgroundTasks.length, 0);
    assert.equal(resolvedStopButtonAttr, 'true');
    assert.equal(state.agentStatus, 'generating');
  });

  it('uses Cursor composer stop control outside the transcript container', () => {
    let resolvedStopButtonAttr: string | null = null;
    const state = withDom(`
      <div id="container">
        <div data-flat-index="1">
          <div data-message-role="human" data-message-id="m1">
            <div class="aislash-editor-input-readonly">hello</div>
          </div>
        </div>
      </div>
      <div class="button-container composer-button-area">
        <div class="send-with-mode">
          <div class="anysphere-icon-button" data-stop-button="true">
            <span class="codicon codicon-debug-stop"></span>
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
        resolvedStopButtonAttr = document
          .querySelector(extracted.agentStopSelectorPath)
          ?.getAttribute('data-stop-button') ?? null;
      }
      return extracted;
    });

    assert.ok(state);
    assert.equal(resolvedStopButtonAttr, 'true');
    assert.equal(state.agentStatus, 'generating');
  });

  it('ignores finished background task summaries in the transcript', () => {
    const state = withDom(`
      <div id="container">
        <div class="composer-messages-container">
          <div class="composer-human-ai-pair-container">
            <div data-expandable="true" class="ui-collapsible" data-open="false">
              <div class="ui-collapsible-header" role="button" aria-expanded="false">
                <span class="ui-tool-call-line">
                  <span class="ui-tool-call-line-action">Finished</span>
                  <span class="ui-tool-call-line-details">2 background tasks</span>
                </span>
                <i class="ui-collapsible-chevron cursor-icon ui-icon"></i>
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
    assert.equal(state.backgroundTasks.length, 0);
  });

  it('reads live background terminal count from composer-toolbar-section above input', () => {
    const state = withDom(`
      <div id="container">
        <div class="composer-messages-container">
          <div class="composer-human-ai-pair-container">
            <div class="ui-collapsible-header">
              <span class="ui-tool-call-line">
                <span class="ui-tool-call-line-action">Finished</span>
                <span class="ui-tool-call-line-details">2 background tasks</span>
              </span>
            </div>
          </div>
        </div>
      </div>
      <div style="padding: 0px 16px;">
        <div id="composer-toolbar-section" class="hide-if-empty">
          <div class="group" style="display: flex; cursor: pointer;">
            <div style="cursor: pointer; min-width: 180px; display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px;">
              <span class="codicon codicon-chevron-right"></span>
              <div style="font-size: 12px;">1 background terminal</div>
            </div>
          </div>
          <div class="group" style="display: flex; cursor: pointer;">
            <div style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; cursor: pointer;">
              <span class="codicon codicon-chevron-right"></span>
              <div style="font-size: 12px;"><span>9 Files</span></div>
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
    assert.equal(state.backgroundTasks[0].label, '1 background terminal');
  });

  it('surfaces collapsed Cursor background terminal summary rows outside the transcript', () => {
    const state = withDom(`
      <div id="container">
        <div class="composer-messages-container"></div>
      </div>
      <div id="composer-toolbar-section">
        <div style="cursor: pointer; min-width: 180px; display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px;">
          <span class="codicon codicon-chevron-right"></span>
          <div style="font-size: 12px; white-space: nowrap;">1 background terminal</div>
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
    assert.equal(state.backgroundTasks[0].label, '1 background terminal');
  });

  it('surfaces collapsed Cursor background terminal summary rows', () => {
    const state = withDom(`
      <div id="container">
        <div id="composer-toolbar-section">
          <div style="cursor: pointer; min-width: 180px; display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px;">
            <span class="codicon codicon-chevron-right"></span>
            <div style="font-size: 12px; white-space: nowrap;">1 background terminal</div>
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
    assert.equal(state.backgroundTasks[0].label, '1 background terminal');
    assert.equal(state.backgroundTasks[0].stopSelectorPath, undefined);
    assert.match(state.backgroundTasks[0].expandSelectorPath || '', /composer-toolbar-section/);
  });

  it('uses summary count when collapsed summary coexists with fewer detailed items', () => {
    const state = withDom(`
      <div id="container">
        <div id="composer-toolbar-section">
          <div class="composer-toolbar-background-job-item composer-toolbar-background-job-item-clickable">
            <div class="composer-toolbar-background-job-item-text">npm run dev</div>
            <div class="composer-toolbar-background-job-item-stop"><span>Stop</span></div>
          </div>
          <div style="cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
            <span class="codicon codicon-chevron-right"></span>
            <div>2 background terminals</div>
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
    assert.equal(state.backgroundTasks.length, 2);
    assert.ok(state.backgroundTasks.some(task => task.label === 'npm run dev'));
    assert.ok(state.backgroundTasks.some(task => task.label === '2 background terminals'));
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

  it('surfaces foreground waiting nudge alongside toolbar background terminal', () => {
    const state = withDom(`
      <div id="container">
        <div class="composer-messages-container">
          <div class="composer-foreground-shell-background-nudge-line">
            <span class="ui-tool-call-line-action">Waiting for 1 command to finish</span>
            <button type="button" class="ui-tool-call-line-details-button">Run in background</button>
          </div>
        </div>
      </div>
      <div id="composer-toolbar-section">
        <div style="cursor: pointer; display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px;">
          <span class="codicon codicon-chevron-right"></span>
          <div>1 background terminal</div>
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
    assert.ok(state.backgroundTasks.some(task => task.label === '1 background terminal'));
    assert.ok(state.backgroundTasks.some(task => task.label === 'Waiting for 1 command to finish'));
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
