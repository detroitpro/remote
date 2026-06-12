import type { CursorState } from '../server/types.js';

/** Stable key for which chat transcript the server/client should show. */
export function getHistoryScopeKey(
  state: Pick<CursorState, 'activeWindowId' | 'activeComposerId' | 'chatTabs'>,
): string {
  const activeTab =
    state.chatTabs.find((t) => t.isActive && t.source === 'open') ??
    state.chatTabs.find((t) => t.isActive);
  const tabComposerId = activeTab?.composerId ?? '';
  const tabTitle = (activeTab?.title ?? '').trim().replace(/\s+/g, ' ');
  return [
    state.activeWindowId,
    state.activeComposerId,
    tabComposerId,
    tabTitle,
  ].join('|');
}
