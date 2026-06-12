import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act } from 'react';
import { QuestionnaireBar } from '../src/client/components/decision/QuestionnaireBar.js';
import { baseCursorState, createComponentTestEnv } from './helpers/component-test-env.js';

describe('QuestionnaireBar component', () => {
  let env: ReturnType<typeof createComponentTestEnv>;

  beforeEach(() => {
    env = createComponentTestEnv();
  });

  afterEach(() => env.cleanup());

  it('hides bar when questionnaire is null', () => {
    env.render(React.createElement(QuestionnaireBar, {
      state: baseCursorState({ questionnaire: null }),
    }));

    const bar = env.document.getElementById('questionnaire-bar')!;
    assert.ok(bar.classList.contains('hidden'));
  });

  it('renders questions and selected option from server state', () => {
    env.render(React.createElement(QuestionnaireBar, {
      state: baseCursorState({
        questionnaire: {
          questions: [{
            number: '1.',
            text: 'Pick a color?',
            isActive: true,
            options: [
              { letter: 'A', label: 'Red', isFreeform: false, isSelected: true, selectorPath: 'sp-red' },
              { letter: 'B', label: 'Blue', isFreeform: false, isSelected: false, selectorPath: 'sp-blue' },
            ],
          }],
          activeIndex: 0,
          totalLabel: '1 of 1',
          skipSelectorPath: 'sp-skip',
          continueSelectorPath: 'sp-continue',
          continueDisabled: true,
        },
      }),
    }));

    const bar = env.document.getElementById('questionnaire-bar')!;
    assert.ok(!bar.classList.contains('hidden'));
    const options = bar.querySelectorAll('.questionnaire-option');
    assert.equal(options.length, 2);
    assert.ok(options[0].classList.contains('questionnaire-option-selected'));
    assert.ok(!options[1].classList.contains('questionnaire-option-selected'));
    const continueBtn = env.document.getElementById('btn-q-continue') as HTMLButtonElement;
    assert.ok(continueBtn.disabled);
  });

  it('updates selected option optimistically on click', () => {
    env.render(React.createElement(QuestionnaireBar, {
      state: baseCursorState({
        questionnaire: {
          questions: [{
            number: '1.',
            text: 'Pick?',
            isActive: true,
            options: [
              { letter: 'A', label: 'Red', isFreeform: false, isSelected: true, selectorPath: 'sp-red' },
              { letter: 'B', label: 'Blue', isFreeform: false, isSelected: false, selectorPath: 'sp-blue' },
            ],
          }],
          activeIndex: 0,
          totalLabel: '1 of 1',
          skipSelectorPath: 'sp-skip',
          continueSelectorPath: 'sp-continue',
          continueDisabled: false,
        },
      }),
    }));

    const options = env.document.querySelectorAll('.questionnaire-option');
    act(() => (options[1] as HTMLButtonElement).click());

    assert.ok(!options[0].classList.contains('questionnaire-option-selected'));
    assert.ok(options[1].classList.contains('questionnaire-option-selected'));
    const sent = env.command.emitted.find(item => item.event === 'command:click_action');
    assert.ok(sent);
    assert.equal(sent.payload.selectorPath, 'sp-blue');
  });

  it('does not send click when already-selected option is clicked again', () => {
    env.render(React.createElement(QuestionnaireBar, {
      state: baseCursorState({
        questionnaire: {
          questions: [{
            number: '1.',
            text: 'Pick?',
            isActive: true,
            options: [
              { letter: 'A', label: 'Red', isFreeform: false, isSelected: true, selectorPath: 'sp-red' },
              { letter: 'B', label: 'Blue', isFreeform: false, isSelected: false, selectorPath: 'sp-blue' },
            ],
          }],
          activeIndex: 0,
          totalLabel: '1 of 1',
          skipSelectorPath: 'sp-skip',
          continueSelectorPath: 'sp-continue',
          continueDisabled: false,
        },
      }),
    }));

    const options = env.document.querySelectorAll('.questionnaire-option');
    const clicksBefore = env.command.emitted.filter(item => item.event === 'command:click_action').length;
    act(() => (options[0] as HTMLButtonElement).click());

    assert.ok(options[0].classList.contains('questionnaire-option-selected'));
    const clicksAfter = env.command.emitted.filter(item => item.event === 'command:click_action').length;
    assert.equal(clicksAfter, clicksBefore);
  });

  it('deselects option in multi-select question', () => {
    env.render(React.createElement(QuestionnaireBar, {
      state: baseCursorState({
        questionnaire: {
          questions: [{
            number: '2.',
            text: 'Pick many?',
            isActive: true,
            options: [
              { letter: 'A', label: 'One', isFreeform: false, isSelected: true, selectorPath: 'sp-a' },
              { letter: 'B', label: 'Two', isFreeform: false, isSelected: true, selectorPath: 'sp-b' },
              { letter: 'C', label: 'Three', isFreeform: false, isSelected: false, selectorPath: 'sp-c' },
            ],
          }],
          activeIndex: 0,
          totalLabel: '1 of 1',
          skipSelectorPath: 'sp-skip',
          continueSelectorPath: 'sp-continue',
          continueDisabled: false,
        },
      }),
    }));

    const options = env.document.querySelectorAll('.questionnaire-option');
    act(() => (options[0] as HTMLButtonElement).click());

    assert.ok(!options[0].classList.contains('questionnaire-option-selected'));
    assert.ok(options[1].classList.contains('questionnaire-option-selected'));
    const sent = env.command.emitted.find(item => item.event === 'command:click_action');
    assert.ok(sent);
    assert.equal(sent.payload.selectorPath, 'sp-a');
  });
});
