import type { ChatTab } from '../../server/types.js';

export interface ChatTabGroups {
  openTabs: ChatTab[];
  listTabs: ChatTab[];
}

function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isNewAgentListEntry(title: string): boolean {
  const normalized = normalizeTitle(title);
  return normalized === 'new agent' || normalized.endsWith(' / new agent');
}

function tabIdentity(tab: ChatTab): string {
  if (tab.composerId?.trim()) {
    return `composer:${tab.composerId.trim()}`;
  }
  return `title:${normalizeTitle(tab.title || '')}`;
}

function shouldHideListTab(tab: ChatTab, openKeys: Set<string>): boolean {
  if (tab.source === 'open') return true;
  if (isNewAgentListEntry(tab.title || '')) return true;
  if (openKeys.has(tabIdentity(tab))) return true;

  const normalizedTitle = normalizeTitle(tab.title || '');
  if (!normalizedTitle) return false;

  // Match by title when open editor tabs use different ids (resource-name UUID vs
  // sidebar tab-N / glass: synthetic ids).
  return openKeys.has(`title:${normalizedTitle}`);
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
  const listTabs = tabs.filter(tab => !shouldHideListTab(tab, openKeys));

  return { openTabs, listTabs };
}
