import React from 'react';
import type { CursorWindow } from '../../../server/types.js';
import { useCommandClient } from '../../state/commandClient.js';

export interface WindowPickerProps {
  windows: CursorWindow[];
  activeWindowId: string;
}

export function WindowPicker({ windows, activeWindowId }: WindowPickerProps) {
  const command = useCommandClient();
  if (windows.length <= 1) {
    return (
      <nav id="window-bar" className="window-bar hidden">
        <div id="window-list" className="window-list" />
      </nav>
    );
  }
  return (
    <nav id="window-bar" className="window-bar">
      <div id="window-list" className="window-list">
        {windows.map(win => (
          <button
            key={win.id}
            className={`window-item ${win.id === activeWindowId ? 'active' : ''}`}
            type="button"
            title={win.title || 'Window'}
            onClick={() => command.emit('command:switch_window', { windowId: win.id })}
          >
            {win.title || 'Window'}
          </button>
        ))}
      </div>
    </nav>
  );
}
