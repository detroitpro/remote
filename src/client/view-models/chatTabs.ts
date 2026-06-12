import type { ChatTab } from '../../server/types.js';

export interface ChatTabGroups {
  openTabs: ChatTab[];
  listTabs: ChatTab[];
}

function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isComposerUuid(value?: string): boolean {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function tabIdentity(tab: ChatTab): string {
  if (tab.composerId?.trim()) {
    return `composer:${tab.composerId.trim()}`;
  }
  return `title:${normalizeTitle(tab.title || '')}`;
}

function shouldHideListTab(tab: ChatTab, openKeys: Set<string>): boolean {
  if (tab.source === 'open') return true;
  if (openKeys.has(tabIdentity(tab))) return true;

  const normalizedTitle = normalizeTitle(tab.title || '');
  if (!normalizedTitle) return false;
  if (!isComposerUuid(tab.composerId)) return false;

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
