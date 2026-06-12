import type { CommandClient } from '../state/commandClient.js';

export function setMode(command: CommandClient, modeId: string): void {
  command.emit('command:set_mode', { modeId });
}

export function setModel(command: CommandClient, modelId: string): void {
  command.emit('command:set_model', { modelId });
}

export function setPlanModel(
  command: CommandClient,
  selectorPath: string,
  planModelId: string,
): void {
  command.emit('command:set_plan_model', { selectorPath, planModelId });
}

export function clickSheetAction(command: CommandClient, selectorPath: string): void {
  command.emit('command:click_action', { selectorPath });
}
