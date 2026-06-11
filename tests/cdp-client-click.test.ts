import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CdpClient, shouldUseNativeClick } from '../src/server/cdp-client.js';

describe('cdp client click behavior', () => {
  it('prefers native click for generic div summary rows', () => {
    assert.equal(shouldUseNativeClick('DIV', null), true);
  });

  it('keeps DOM click for button-like elements', () => {
    assert.equal(shouldUseNativeClick('BUTTON', null), false);
    assert.equal(shouldUseNativeClick('DIV', 'button'), false);
  });

  it('dispatches native mouse events when native click is preferred', async () => {
    const client = new CdpClient();
    const sent: Array<{ method: string; params?: Record<string, unknown> }> = [];

    (client as unknown as { evaluate: typeof client.evaluate }).evaluate = async () => ({
      ok: true,
      usedNative: true,
      x: 120,
      y: 48,
      width: 200,
      height: 24,
    });
    (client as unknown as { send: typeof client.send }).send = async (method, params) => {
      sent.push({ method, params });
      return {};
    };

    await client.click('#expand-summary');

    assert.deepEqual(sent.map(item => item.method), [
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
    ]);
  });

  it('does not dispatch native mouse events for DOM-clickable controls', async () => {
    const client = new CdpClient();
    const sent: Array<{ method: string; params?: Record<string, unknown> }> = [];

    (client as unknown as { evaluate: typeof client.evaluate }).evaluate = async () => ({
      ok: true,
      usedNative: false,
    });
    (client as unknown as { send: typeof client.send }).send = async (method, params) => {
      sent.push({ method, params });
      return {};
    };

    await client.click('#button-like');

    assert.equal(sent.length, 0);
  });
});
