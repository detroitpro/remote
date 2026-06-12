import type { QuestionnaireOption } from '../../server/types.js';
import type { CommandClient } from '../state/commandClient.js';
import {
  countSelectedInQuestion,
  isQuestionnaireOptionSelected,
  type QuestionnaireSelectionMap,
} from '../view-models/questionnaire.js';

export interface QuestionnaireClickResult {
  next: QuestionnaireSelectionMap;
  shouldClick: boolean;
}

export function applyQuestionnaireOptionClick(
  current: QuestionnaireSelectionMap,
  questionOptions: QuestionnaireOption[],
  clickedOption: QuestionnaireOption,
  knownMultiSelect: boolean,
): QuestionnaireClickResult {
  const alreadySelected = isQuestionnaireOptionSelected(clickedOption, current);
  const selectedCount = countSelectedInQuestion(questionOptions, current);
  const multiSelect = knownMultiSelect || selectedCount > 1;

  if (alreadySelected) {
    if (!multiSelect) {
      return { next: current, shouldClick: false };
    }
    const next = { ...current, [clickedOption.selectorPath]: false };
    return { next, shouldClick: true };
  }

  const next = { ...current };
  if (!multiSelect) {
    for (const candidate of questionOptions) {
      next[candidate.selectorPath] = false;
    }
  }
  next[clickedOption.selectorPath] = true;
  return { next, shouldClick: true };
}

/** @deprecated Use applyQuestionnaireOptionClick */
export function selectQuestionnaireOption(
  current: QuestionnaireSelectionMap,
  questionOptions: QuestionnaireOption[],
  selectedOption: QuestionnaireOption,
  knownMultiSelect = false,
): QuestionnaireSelectionMap {
  return applyQuestionnaireOptionClick(current, questionOptions, selectedOption, knownMultiSelect).next;
}

export function clickQuestionnaireOption(
  command: CommandClient,
  selectorPath: string,
): void {
  command.emit('command:click_action', { selectorPath });
}

export function clickQuestionnaireSkip(command: CommandClient, selectorPath: string): void {
  command.emit('command:click_action', { selectorPath });
}

export function clickQuestionnaireContinue(command: CommandClient, selectorPath: string): void {
  command.emit('command:click_action', { selectorPath });
}
