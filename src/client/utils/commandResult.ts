import type { CommandResult } from '../../server/types.js';

export function commandResultData<T>(result: CommandResult): T | null {
  return (result.data ?? null) as T | null;
}
