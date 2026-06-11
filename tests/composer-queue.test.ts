import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/** Mirrors dom-extractor queueActionSelector for unit testing. */
function queueActionSelector(qid: string, action: string): string {
  return `.composer-toolbar-queue-item[data-queue-item-id="${qid}"] [data-queue-action="${action}"] .anysphere-icon-button`;
}

describe('composer queue action selectors', () => {
  it('builds stable selectors from data-queue-item-id and data-queue-action', () => {
    const id = '8074ca4e-e1a1-41ab-9c31-2b44d5e3664f';
    assert.equal(
      queueActionSelector(id, 'send'),
      `.composer-toolbar-queue-item[data-queue-item-id="${id}"] [data-queue-action="send"] .anysphere-icon-button`
    );
    assert.equal(
      queueActionSelector(id, 'remove'),
      `.composer-toolbar-queue-item[data-queue-item-id="${id}"] [data-queue-action="remove"] .anysphere-icon-button`
    );
  });
});
