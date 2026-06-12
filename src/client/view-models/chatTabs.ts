import type { ChatTab } from '../../server/types.js';

export interface ChatTabGroups {
  openTabs: ChatTab[];
  listTabs: ChatTab[];
}

function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

function tabIdentity(tab: ChatTab): string {
  if (tab.composerId?.trim()) {
    return `composer:${tab.composerId.trim()}`;
  }
  return `title:${normalizeTitle(tab.title || '')}`;
}

export function buildChatTabGroups(tabs: ChatTab[]): ChatTabGroups {
  const openTabs = tabs.filter(tab => tab.source === 'open');
  const openKeys = new Set<string>();
  for (const tab of openTabs) {
    openKeys.add(tabIdentity(tab));
    const normalizedTitle = normalizeTitle(tab.title || '');
    if (normalizedTitle) {
      openKeys.add(`title:${normalizedTitle}`);
    }
  }
  const listTabs = tabs.filter((tab) => {
    if (tab.source === 'open') return false;
    const identity = tabIdentity(tab);
    return !openKeys.has(identity);
  });

  return { openTabs, listTabs };
}
