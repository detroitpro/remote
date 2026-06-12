import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { selectQuestionnaireOption } from '../src/client/actions/questionnaireActions.js';
import type { QuestionnaireOption } from '../src/server/types.js';

function option(overrides: Partial<QuestionnaireOption>): QuestionnaireOption {
  return {
    letter: 'A',
    label: 'Option A',
    selectorPath: '#opt-a',
    isSelected: false,
    ...overrides,
  };
}

describe('selectQuestionnaireOption', () => {
  it('clears other options in the same question and selects the clicked option', () => {
    const options = [
      option({ letter: 'A', selectorPath: '#opt-a', isSelected: true }),
      option({ letter: 'B', selectorPath: '#opt-b', isSelected: false }),
    ];
    const next = selectQuestionnaireOption(
      { '#opt-a': true, '#opt-b': false },
      options,
      options[1],
    );

    assert.equal(next['#opt-a'], false);
    assert.equal(next['#opt-b'], true);
  });
});
