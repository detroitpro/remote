import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildQuestionnaireSelectionMap,
  isQuestionnaireOptionSelected,
} from '../src/client/view-models/questionnaire.js';
import type { Questionnaire, QuestionnaireOption } from '../src/server/types.js';

function option(overrides: Partial<QuestionnaireOption>): QuestionnaireOption {
  return {
    letter: 'A',
    label: 'Option A',
    selectorPath: '#opt-a',
    isSelected: false,
    ...overrides,
  };
}

describe('questionnaire view model', () => {
  it('buildQuestionnaireSelectionMap marks only server-selected options', () => {
    const questionnaire: Questionnaire = {
      questions: [{
        number: '1.',
        text: 'Pick one',
        isActive: true,
        options: [
          option({ selectorPath: '#a', isSelected: true }),
          option({ letter: 'B', selectorPath: '#b', isSelected: false }),
        ],
      }],
      activeIndex: 0,
      totalLabel: '1 of 1',
      skipSelectorPath: '#skip',
      continueSelectorPath: '#continue',
      continueDisabled: false,
    };

    const map = buildQuestionnaireSelectionMap(questionnaire);
    assert.equal(map['#a'], true);
    assert.equal(map['#b'], undefined);
  });

  it('isQuestionnaireOptionSelected prefers optimistic map over server state', () => {
    const selected = option({ selectorPath: '#a', isSelected: false });
    assert.equal(isQuestionnaireOptionSelected(selected, { '#a': true }), true);
    assert.equal(isQuestionnaireOptionSelected(selected, { '#a': false }), false);
  });

  it('isQuestionnaireOptionSelected falls back to server isSelected', () => {
    const selected = option({ selectorPath: '#a', isSelected: true });
    assert.equal(isQuestionnaireOptionSelected(selected, {}), true);
  });
});
