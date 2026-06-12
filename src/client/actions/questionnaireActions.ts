import type { QuestionnaireOption } from '../../server/types.js';
import type { CommandClient } from '../state/commandClient.js';
import type { QuestionnaireSelectionMap } from '../view-models/questionnaire.js';

export function selectQuestionnaireOption(
  current: QuestionnaireSelectionMap,
  questionOptions: QuestionnaireOption[],
  selectedOption: QuestionnaireOption,
): QuestionnaireSelectionMap {
  const next = { ...current };
  for (const candidate of questionOptions) {
    next[candidate.selectorPath] = false;
  }
  next[selectedOption.selectorPath] = true;
  return next;
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
