import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyQuestionnaireOptionClick } from '../src/client/actions/questionnaireActions.js';
import type { QuestionnaireOption } from '../src/server/types.js';

function option(overrides: Partial<QuestionnaireOption>): QuestionnaireOption {
  return {
    letter: 'A',
    label: 'Option A',
    selectorPath: '#opt-a',
    isSelected: false,
    isFreeform: false,
    ...overrides,
  };
}

describe('applyQuestionnaireOptionClick', () => {
  it('clears other options in single-select and selects the clicked option', () => {
    const options = [
      option({ letter: 'A', selectorPath: '#opt-a', isSelected: true }),
      option({ letter: 'B', selectorPath: '#opt-b', isSelected: false }),
    ];
    const result = applyQuestionnaireOptionClick(
      { '#opt-a': true, '#opt-b': false },
      options,
      options[1],
      false,
    );

    assert.equal(result.shouldClick, true);
    assert.equal(result.next['#opt-a'], false);
    assert.equal(result.next['#opt-b'], true);
  });

  it('keeps existing selections when adding in multi-select questions', () => {
    const options = [
      option({ letter: 'A', selectorPath: '#opt-a', isSelected: true }),
      option({ letter: 'B', selectorPath: '#opt-b', isSelected: true }),
      option({ letter: 'C', selectorPath: '#opt-c', isSelected: false }),
    ];
    const result = applyQuestionnaireOptionClick(
      { '#opt-a': true, '#opt-b': true, '#opt-c': false },
      options,
      options[2],
      true,
    );

    assert.equal(result.shouldClick, true);
    assert.equal(result.next['#opt-a'], true);
    assert.equal(result.next['#opt-b'], true);
    assert.equal(result.next['#opt-c'], true);
  });

  it('does not click when already-selected option is clicked in single-select', () => {
    const options = [
      option({ letter: 'A', selectorPath: '#opt-a', isSelected: true }),
      option({ letter: 'B', selectorPath: '#opt-b', isSelected: false }),
    ];
    const current = { '#opt-a': true, '#opt-b': false };
    const result = applyQuestionnaireOptionClick(current, options, options[0], false);
    assert.equal(result.shouldClick, false);
    assert.deepEqual(result.next, current);
  });

  it('deselects option when clicked again in multi-select', () => {
    const options = [
      option({ letter: 'A', selectorPath: '#opt-a', isSelected: true }),
      option({ letter: 'B', selectorPath: '#opt-b', isSelected: true }),
      option({ letter: 'C', selectorPath: '#opt-c', isSelected: false }),
    ];
    const result = applyQuestionnaireOptionClick(
      { '#opt-a': true, '#opt-b': true, '#opt-c': false },
      options,
      options[0],
      true,
    );

    assert.equal(result.shouldClick, true);
    assert.equal(result.next['#opt-a'], false);
    assert.equal(result.next['#opt-b'], true);
  });
});
