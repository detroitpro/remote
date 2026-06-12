import type { Questionnaire, QuestionnaireOption } from '../../server/types.js';

export interface QuestionnaireSelectionMap {
  [selectorPath: string]: boolean;
}

export function buildQuestionnaireSelectionMap(questionnaire: Questionnaire | null | undefined): QuestionnaireSelectionMap {
  const selected: QuestionnaireSelectionMap = {};
  for (const question of questionnaire?.questions ?? []) {
    for (const option of question.options ?? []) {
      if (option.isSelected) {
        selected[option.selectorPath] = true;
      }
    }
  }
  return selected;
}

export function isQuestionnaireOptionSelected(
  option: QuestionnaireOption,
  optimisticSelections: QuestionnaireSelectionMap,
): boolean {
  const optimisticValue = optimisticSelections[option.selectorPath];
  if (typeof optimisticValue === 'boolean') return optimisticValue;
  return !!option.isSelected;
}
