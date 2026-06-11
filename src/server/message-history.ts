import type { ChatElement } from './types.js';

/** Merge DOM snapshots by stable message id; newest extraction wins per id. */
export function mergeMessages(existing: ChatElement[], incoming: ChatElement[]): ChatElement[] {
  if (incoming.length === 0) return existing.slice();
  const byId = new Map<string, ChatElement>();
  for (const msg of existing) byId.set(msg.id, msg);
  for (const msg of incoming) byId.set(msg.id, msg);
  return Array.from(byId.values()).sort((a, b) => a.flatIndex - b.flatIndex);
}
