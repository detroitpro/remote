import React, { useEffect, useState } from 'react';
import type { PlanModelOption } from '../../../../server/types.js';
import { setPlanModel } from '../../../actions/sheetActions.js';
import { useCommandClient } from '../../../state/commandClient.js';
import { useUiState } from '../../../state/uiState.js';
import { commandResultData } from '../../../utils/commandResult.js';

export interface PlanModelSheetProps {
  visible: boolean;
}

export function PlanModelSheet({ visible }: PlanModelSheetProps) {
  const command = useCommandClient();
  const ui = useUiState();
  const plan = ui.planModelContext;
  const [options, setOptions] = useState<PlanModelOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !plan?.modelDropdownSelectorPath) return;
    let cancelled = false;
    setLoading(true);
    void command.sendCommandAwaitResult('command:get_plan_model_options', {
      selectorPath: plan.modelDropdownSelectorPath,
    }).then(result => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        ui.showToast(result.error || 'Failed to load plan models', 'error');
        return;
      }
      const data = commandResultData<{ options?: PlanModelOption[] }>(result);
      setOptions(Array.isArray(data?.options) ? data.options : []);
    });
    return () => {
      cancelled = true;
    };
  }, [command, plan?.modelDropdownSelectorPath, ui, visible]);

  return (
    <div id="sheet-plan-model" className={`bottom-sheet ${visible ? '' : 'hidden'}`}>
      <div id="sheet-plan-model-header" className="sheet-header">{plan?.title || 'Plan Model'}</div>
      <div id="sheet-plan-model-list" className="sheet-list">
        {loading && <div className="sheet-item"><span>Loading...</span></div>}
        {!loading && options.length === 0 && <div className="sheet-item"><span>{plan?.model || 'Auto'}</span></div>}
        {options.map(option => (
          <button
            key={option.id}
            type="button"
            className={`sheet-item ${option.selected ? 'active' : ''}`}
            onClick={() => {
              if (!plan?.modelDropdownSelectorPath) return;
              setPlanModel(command, plan.modelDropdownSelectorPath, option.id);
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
