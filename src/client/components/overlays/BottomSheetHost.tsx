import React from 'react';
import type { CursorState } from '../../../server/types.js';
import type { HealthSnapshot } from '../../state/serverHealth.js';
import { useUiState } from '../../state/uiState.js';
import { BackgroundTasksSheet } from './sheets/BackgroundTasksSheet.js';
import { DebugSheet } from './sheets/DebugSheet.js';
import { ModeSheet } from './sheets/ModeSheet.js';
import { ModelSheet } from './sheets/ModelSheet.js';
import { PlanModelSheet } from './sheets/PlanModelSheet.js';
import { QueueActionsSheet } from './sheets/QueueActionsSheet.js';
import { TabActionsSheet } from './sheets/TabActionsSheet.js';

export interface BottomSheetHostProps {
  state: CursorState;
  serverHealth: HealthSnapshot | null;
  socketConnected: boolean;
  sendPending: boolean;
}

export function BottomSheetHost({
  state,
  serverHealth,
  socketConnected,
  sendPending,
}: BottomSheetHostProps) {
  const ui = useUiState();
  const active = ui.activeSheet;
  return (
    <>
      <div id="sheet-overlay" className={`sheet-overlay ${active ? '' : 'hidden'}`} onClick={ui.closeSheet} />
      <ModeSheet state={state} visible={active === 'mode'} />
      <ModelSheet state={state} visible={active === 'model'} />
      <PlanModelSheet visible={active === 'plan-model'} />
      <TabActionsSheet state={state} visible={active === 'tab'} />
      <QueueActionsSheet visible={active === 'queue'} />
      <BackgroundTasksSheet state={state} visible={active === 'background-tasks'} />
      <DebugSheet
        visible={active === 'debug'}
        state={state}
        serverHealth={serverHealth}
        socketConnected={socketConnected}
        sendPending={sendPending}
      />
    </>
  );
}
