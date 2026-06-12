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

export function countSelectedInQuestion(
  questionOptions: QuestionnaireOption[],
  selections: QuestionnaireSelectionMap,
): number {
  return questionOptions.filter(o => isQuestionnaireOptionSelected(o, selections)).length;
}

export function detectMultiSelectQuestions(
  questionnaire: Questionnaire | null | undefined,
): string[] {
  const keys: string[] = [];
  for (const question of questionnaire?.questions ?? []) {
    if (question.options.filter(o => o.isSelected).length > 1) {
      keys.push(question.number);
    }
  }
  return keys;
}
