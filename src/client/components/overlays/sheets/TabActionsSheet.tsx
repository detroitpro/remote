import React from 'react';
import type { CursorState } from '../../../../server/types.js';
import { useCommandClient } from '../../../state/commandClient.js';
import { useUiState } from '../../../state/uiState.js';

export interface TabActionsSheetProps {
  state: CursorState;
  visible: boolean;
}

export function TabActionsSheet({ state, visible }: TabActionsSheetProps) {
  const ui = useUiState();
  const command = useCommandClient();
  const tab = state.chatTabs.find(item => item.composerId === ui.tabSheetComposerId) || null;
  return (
    <div id="sheet-tab" className={`bottom-sheet ${visible ? '' : 'hidden'}`}>
      <div id="sheet-tab-header" className="sheet-header">{tab?.title || 'Tab'}</div>
      <div id="sheet-tab-list" className="sheet-list">
        {tab && (
          <>
            <button className="sheet-item" type="button" onClick={() => {
              command.emit('command:switch_tab', {
                composerId: tab.composerId,
                selectorPath: tab.selectorPath,
                tabTitle: tab.title,
                tabSource: tab.source,
              });
              ui.closeSheet();
            }}>Open</button>
            <button className="sheet-item sheet-item-danger" type="button" onClick={() => {
              command.emit('command:close_tab', {
                composerId: tab.composerId,
                selectorPath: tab.selectorPath,
                tabTitle: tab.title,
                tabSource: tab.source,
              });
              ui.closeSheet();
            }}>Close</button>
          </>
        )}
      </div>
    </div>
  );
}
