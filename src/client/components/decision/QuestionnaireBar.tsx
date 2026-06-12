import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CursorState } from '../../../server/types.js';
import type { QuestionnaireOption } from '../../../server/types.js';
import {
  applyQuestionnaireOptionClick,
  clickQuestionnaireContinue,
  clickQuestionnaireOption,
  clickQuestionnaireSkip,
} from '../../actions/questionnaireActions.js';
import { useCommandClient } from '../../state/commandClient.js';
import { useUiState } from '../../state/uiState.js';
import {
  buildQuestionnaireSelectionMap,
  countSelectedInQuestion,
  detectMultiSelectQuestions,
  type QuestionnaireSelectionMap,
} from '../../view-models/questionnaire.js';
import { QuestionnaireQuestion } from './QuestionnaireQuestion.js';

export interface QuestionnaireBarProps {
  state: CursorState;
}

export function QuestionnaireBar({ state }: QuestionnaireBarProps) {
  const command = useCommandClient();
  const ui = useUiState();
  const q = state.questionnaire;
  const [optimisticSelections, setOptimisticSelections] = useState<QuestionnaireSelectionMap>(
    () => buildQuestionnaireSelectionMap(q),
  );
  const selectionsRef = useRef(optimisticSelections);
  const multiSelectQuestionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const next = buildQuestionnaireSelectionMap(q);
    for (const questionNumber of detectMultiSelectQuestions(q)) {
      multiSelectQuestionsRef.current.add(questionNumber);
    }
    selectionsRef.current = next;
    setOptimisticSelections(next);
  }, [q]);

  const handleSelectOption = useCallback((
    questionNumber: string,
    questionOptions: QuestionnaireOption[],
    option: QuestionnaireOption,
  ) => {
    const current = selectionsRef.current;
    const knownMultiSelect = multiSelectQuestionsRef.current.has(questionNumber);
    const result = applyQuestionnaireOptionClick(current, questionOptions, option, knownMultiSelect);
    if (!result.shouldClick) {
      return;
    }
    if (countSelectedInQuestion(questionOptions, result.next) > 1) {
      multiSelectQuestionsRef.current.add(questionNumber);
    }
    selectionsRef.current = result.next;
    setOptimisticSelections(result.next);
    clickQuestionnaireOption(command, option.selectorPath);
    ui.showToast(`${option.letter} sent`, 'success');
  }, [command, ui]);

  if (!q || !q.questions?.length) {
    return <div id="questionnaire-bar" className="questionnaire-bar hidden" />;
  }

  return (
    <div id="questionnaire-bar" className="questionnaire-bar">
      <div className="questionnaire-header">
        <span className="questionnaire-icon">?</span>
        <span className="questionnaire-title">Questions</span>
        <span id="questionnaire-stepper" className="questionnaire-stepper">{q.totalLabel}</span>
      </div>
      <div id="questionnaire-questions">
        {q.questions.map((question, index) => (
          <QuestionnaireQuestion
            key={`${question.number}:${index}`}
            question={question}
            index={index}
            optimisticSelections={optimisticSelections}
            onSelectOption={handleSelectOption}
          />
        ))}
      </div>
      <div className="questionnaire-actions">
        <button
          id="btn-q-skip"
          className="btn btn-q-skip"
          onClick={() => clickQuestionnaireSkip(command, q.skipSelectorPath)}
        >
          Skip
        </button>
        <button
          id="btn-q-continue"
          className="btn btn-q-continue"
          disabled={q.continueDisabled}
          onClick={() => clickQuestionnaireContinue(command, q.continueSelectorPath)}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
