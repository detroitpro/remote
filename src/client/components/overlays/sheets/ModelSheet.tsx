import React, { useEffect, useState } from 'react';
import type { CursorState, PlanModelOption } from '../../../../server/types.js';
import { setModel } from '../../../actions/sheetActions.js';
import { useCommandClient } from '../../../state/commandClient.js';
import { useUiState } from '../../../state/uiState.js';
import { commandResultData } from '../../../utils/commandResult.js';

export interface ModelSheetProps {
  state: CursorState;
  visible: boolean;
}

export function ModelSheet({ state, visible }: ModelSheetProps) {
  const command = useCommandClient();
  const ui = useUiState();
  const [options, setOptions] = useState<PlanModelOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    void command.sendCommandAwaitResult('command:get_model_options').then(result => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        ui.showToast(result.error || 'Failed to load models', 'error');
        return;
      }
      const data = commandResultData<{ options?: PlanModelOption[] }>(result);
      setOptions(Array.isArray(data?.options) ? data.options : []);
    });
    return () => {
      cancelled = true;
    };
  }, [command, ui, visible]);

  return (
    <div id="sheet-model" className={`bottom-sheet ${visible ? '' : 'hidden'}`}>
      <div className="sheet-header">Model</div>
      <div id="sheet-model-list" className="sheet-list">
        {loading && <div className="sheet-item"><span>Loading...</span></div>}
        {!loading && options.length === 0 && <div className="sheet-item"><span>{state.model?.current || 'Auto'}</span></div>}
        {options.map(option => (
          <button
            key={option.id}
            type="button"
            className={`sheet-item ${option.selected ? 'active' : ''}`}
            onClick={() => {
              setModel(command, option.id);
              ui.closeSheet();
            }}
          >
            <span>{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
