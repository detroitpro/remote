import React from 'react';
import type { ComposerQueueAction } from '../../../../server/types.js';
import { clickSheetAction } from '../../../actions/sheetActions.js';
import { QUEUE_ACTION_LABELS } from '../../../constants/queueActions.js';
import { useCommandClient } from '../../../state/commandClient.js';
import { useUiState } from '../../../state/uiState.js';
import { QueueActionIcon } from './QueueActionIcon.js';

export interface QueueActionsSheetProps {
  visible: boolean;
}

export function QueueActionsSheet({ visible }: QueueActionsSheetProps) {
  const ui = useUiState();
  const command = useCommandClient();
  const item = ui.queueSheetItem;
  const actions = (item?.actions || []).filter(action => action.selectorPath);
  const order = ['send', 'edit', 'remove'];
  const sorted = actions.slice().sort((a, b) => {
    const ai = order.indexOf(a.type);
    const bi = order.indexOf(b.type);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  return (
    <div id="sheet-queue" className={`bottom-sheet ${visible ? '' : 'hidden'}`}>
      <div id="sheet-queue-header" className="sheet-header">{item?.text || 'Queue'}</div>
      <div id="sheet-queue-list" className="sheet-list">
        {sorted.length === 0 && <p className="sheet-tab-hint">No actions are available for this item.</p>}
        {sorted.map(action => (
          <QueueActionButton key={`${action.type}:${action.selectorPath}`} action={action} />
        ))}
      </div>
    </div>
  );

  function QueueActionButton({ action }: { action: ComposerQueueAction }) {
    const label = QUEUE_ACTION_LABELS[action.type] || action.label || action.type;
    return (
      <button
        className={`sheet-item ${action.type === 'remove' ? 'sheet-item-danger' : ''}`}
        type="button"
        onClick={() => {
          clickSheetAction(command, action.selectorPath);
          ui.closeSheet();
          ui.showToast(`${label}...`, 'success');
        }}
      >
        <span className="sheet-item-icon"><QueueActionIcon type={action.type} /></span>
        <span>{label}</span>
      </button>
    );
  }
}
