import React from 'react';
import type { QuestionnaireQuestion as QuestionnaireQuestionType, QuestionnaireOption } from '../../../server/types.js';
import type { QuestionnaireSelectionMap } from '../../view-models/questionnaire.js';
import { QuestionnaireOptionButton } from './QuestionnaireOptionButton.js';

export interface QuestionnaireQuestionProps {
  question: QuestionnaireQuestionType;
  index: number;
  optimisticSelections: QuestionnaireSelectionMap;
  onSelectOption: (questionNumber: string, questionOptions: QuestionnaireOption[], option: QuestionnaireOption) => void;
}

export function QuestionnaireQuestion({
  question,
  index,
  optimisticSelections,
  onSelectOption,
}: QuestionnaireQuestionProps) {
  return (
    <div
      className={`questionnaire-question ${question.isActive ? 'questionnaire-question-active' : ''}`}
    >
      <div className="questionnaire-question-text">
        <span>{question.number}</span> {question.text}
      </div>
      <div className="questionnaire-options">
        {question.options.map(option => (
          <QuestionnaireOptionButton
            key={`${option.letter}:${option.selectorPath}`}
            option={option}
            optimisticSelections={optimisticSelections}
            onSelect={selected => onSelectOption(question.number, question.options, selected)}
          />
        ))}
      </div>
    </div>
  );
}
