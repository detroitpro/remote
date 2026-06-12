import type { CommandClient } from '../state/commandClient.js';

export async function sendStopAgent(command: CommandClient): Promise<{ ok: boolean; error?: string }> {
  const result = await command.sendCommandAwaitResult('command:stop_agent');
  return { ok: result.ok, error: result.error };
}
