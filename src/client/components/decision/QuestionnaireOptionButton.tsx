import React from 'react';
import type { QuestionnaireOption } from '../../../server/types.js';
import type { QuestionnaireSelectionMap } from '../../view-models/questionnaire.js';
import { isQuestionnaireOptionSelected } from '../../view-models/questionnaire.js';

export interface QuestionnaireOptionButtonProps {
  option: QuestionnaireOption;
  optimisticSelections: QuestionnaireSelectionMap;
  onSelect: (option: QuestionnaireOption) => void;
}

export function QuestionnaireOptionButton({
  option,
  optimisticSelections,
  onSelect,
}: QuestionnaireOptionButtonProps) {
  const selected = isQuestionnaireOptionSelected(option, optimisticSelections);
  return (
    <button
      type="button"
      className={`questionnaire-option ${selected ? 'questionnaire-option-selected' : ''}`}
      onClick={() => onSelect(option)}
    >
      <span className="questionnaire-option-letter">{option.letter}</span>
      <span>{option.label}</span>
    </button>
  );
}
