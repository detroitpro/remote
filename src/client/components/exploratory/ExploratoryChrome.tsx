import React from 'react';
import type { ExploratoryUiChrome } from '../../../server/types.js';

export interface StickyTitleBarProps {
  title: string;
}

export function StickyTitleBar({ title }: StickyTitleBarProps) {
  const trimmed = title.trim();
  if (!trimmed) return null;
  return (
    <div id="sticky-title-bar" className="sticky-title-bar" aria-live="polite">
      <span className="sticky-title-label">{trimmed}</span>
    </div>
  );
}

export interface CloudWidgetStripProps {
  widgets: ExploratoryUiChrome['cloudWidgets'];
}

export function CloudWidgetStrip({ widgets }: CloudWidgetStripProps) {
  if (!widgets.length) return null;
  return (
    <div id="cloud-widget-strip" className="cloud-widget-strip">
      {widgets.map(widget => (
        <div key={widget.id} className="cloud-widget-chip" data-id={widget.id}>
          <span className="cloud-widget-label">{widget.label}</span>
          {widget.detail && <span className="cloud-widget-detail">{widget.detail}</span>}
        </div>
      ))}
    </div>
  );
}

export interface SubagentTrayStripProps {
  trays: ExploratoryUiChrome['subagentTrays'];
}

export function SubagentTrayStrip({ trays }: SubagentTrayStripProps) {
  if (!trays.length) return null;
  return (
    <div id="subagent-tray-strip" className="subagent-tray-strip">
      {trays.map(item => (
        <div key={item.id} className="subagent-tray-item" data-id={item.id}>
          <span className="subagent-tray-label">{item.label}</span>
          {item.status && <span className="subagent-tray-status">{item.status}</span>}
        </div>
      ))}
    </div>
  );
}

export interface ExploratoryChromeProps {
  chrome: ExploratoryUiChrome | null | undefined;
}

export function ExploratoryChrome({ chrome }: ExploratoryChromeProps) {
  if (!chrome) return null;
  const hasSticky = !!(chrome.stickyTitle || '').trim();
  const hasCloud = chrome.cloudWidgets.length > 0;
  const hasTrays = chrome.subagentTrays.length > 0;
  if (!hasSticky && !hasCloud && !hasTrays) return null;

  return (
    <div id="exploratory-chrome" className="exploratory-chrome">
      {hasSticky && <StickyTitleBar title={chrome.stickyTitle || ''} />}
      {hasCloud && <CloudWidgetStrip widgets={chrome.cloudWidgets} />}
      {hasTrays && <SubagentTrayStrip trays={chrome.subagentTrays} />}
    </div>
  );
}
