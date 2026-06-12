import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ComposerQueueAction,
  CursorState,
  PlanBlock,
  PlanModelOption,
} from '../../../server/types.js';
import { MODE_OPTIONS } from '../../constants/modeOptions.js';
import { QUEUE_ACTION_LABELS } from '../../constants/queueActions.js';
import { useCommandClient } from '../../state/commandClient.js';
import { fetchDebugInfo, type HealthSnapshot } from '../../state/serverHealth.js';
import { useUiState } from '../../state/uiState.js';
import {
  getBackgroundTasksForSheet,
  getVisibleBackgroundTasks,
} from '../../view-models/backgroundTasks.js';
import { buildStopButtonState } from '../../view-models/stopState.js';
import { commandResultData } from '../../utils/commandResult.js';

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

function ModeSheet({ state, visible }: { state: CursorState; visible: boolean }) {
  const command = useCommandClient();
  const ui = useUiState();
  const current = state.mode?.current || 'agent';
  return (
    <div id="sheet-mode" className={`bottom-sheet ${visible ? '' : 'hidden'}`}>
      <div className="sheet-header">Mode</div>
      <div id="sheet-mode-list" className="sheet-list">
        {MODE_OPTIONS.map(mode => (
          <button
            key={mode.id}
            className={`sheet-item ${mode.id === current ? 'selected' : ''}`}
            type="button"
            onClick={() => {
              command.emit('command:set_mode', { modeId: mode.id });
              ui.closeSheet();
              ui.showToast(`Mode: ${mode.label}`, 'success');
            }}
          >
            <span className="sheet-item-icon">{mode.icon}</span>
            <span>{mode.label}</span>
            {mode.id === current && <span className="sheet-item-check">✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function ModelSheet({ state, visible }: { state: CursorState; visible: boolean }) {
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
              command.emit('command:set_model', { modelId: option.id });
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

function PlanModelSheet({ visible }: { visible: boolean }) {
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
              command.emit('command:set_plan_model', {
                selectorPath: plan.modelDropdownSelectorPath,
                planModelId: option.id,
              });
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

function TabActionsSheet({ state, visible }: { state: CursorState; visible: boolean }) {
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

function QueueActionsSheet({ visible }: { visible: boolean }) {
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
          command.emit('command:click_action', { selectorPath: action.selectorPath });
          ui.closeSheet();
          ui.showToast(`${label}...`, 'success');
        }}
      >
        <span className="sheet-item-icon">{action.type === 'send' ? '^' : action.type === 'remove' ? 'x' : '*'}</span>
        <span>{label}</span>
      </button>
    );
  }
}

function BackgroundTasksSheet({ state, visible }: { state: CursorState; visible: boolean }) {
  const ui = useUiState();
  const command = useCommandClient();
  const tasks = getBackgroundTasksForSheet(getVisibleBackgroundTasks(state));
  return (
    <div id="sheet-background-tasks" className={`bottom-sheet ${visible ? '' : 'hidden'}`}>
      <div className="sheet-header">Background Tasks</div>
      <div id="sheet-background-tasks-list" className="sheet-list">
        {tasks.length === 0 && <p className="sheet-tab-hint">No background tasks are running.</p>}
        {tasks.map((task, index) => (
          <div key={task.id || index} className="background-task-sheet-item">
            <div className="background-task-sheet-main">
              <div className="background-task-sheet-title">{task.label || `Background task ${index + 1}`}</div>
              {task.detail && <div className="background-task-sheet-detail">{task.detail}</div>}
            </div>
            {task.stopSelectorPath ? (
              <button
                type="button"
                className="background-task-stop"
                onClick={() => {
                  command.emit('command:click_action', { selectorPath: task.stopSelectorPath });
                  ui.closeSheet();
                  ui.showToast('Stop sent', 'success');
                }}
              >
                Stop
              </button>
            ) : (
              <span className="background-task-no-action">No stop</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DebugSheet({
  visible,
  state,
  serverHealth,
  socketConnected,
  sendPending,
}: {
  visible: boolean;
  state: CursorState;
  serverHealth: HealthSnapshot | null;
  socketConnected: boolean;
  sendPending: boolean;
}) {
  const ui = useUiState();
  const command = useCommandClient();
  const [details, setDetails] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadDetails = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchDebugInfo() as Record<string, unknown>;
      setDetails(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    void loadDetails();
  }, [visible, loadDetails]);

  const rows = useMemo(() => {
    const bridge = details?.extensionBridge as Record<string, unknown> | undefined;
    const bridgeDebug = bridge?.gitBridgeDebug as Record<string, unknown> | undefined;
    const gitSnapshots = details?.gitSnapshots as Record<string, unknown> | undefined;
    const snapshotEntries = gitSnapshots?.windowSnapshots as Record<string, {
      changedCount: number;
      updatedAt: number;
      repoBreakdown?: Array<{ label: string; changedCount: number }>;
    }> | undefined;
    const snapshotSummary = snapshotEntries
      ? Object.entries(snapshotEntries)
        .map(([key, snap]) => `${key}:F:${snap.changedCount}`)
        .join(', ')
      : '—';
    const server = (details?.server ?? serverHealth?.server) as Record<string, unknown> | undefined;
    const repoBreakdown = Array.isArray(bridgeDebug?.repoBreakdown)
      ? bridgeDebug.repoBreakdown.map((repo: { label: string; changedCount: number }) => `${repo.label}:${repo.changedCount}`).join(', ')
      : '—';
    const clientStopState = buildStopButtonState({
      state,
      sendPending,
      stopPending: false,
      lastKnownStopSelectorPath: '',
    });
    return [
      ['Client URL', window.location.origin],
      ['Socket', socketConnected ? 'connected' : 'disconnected'],
      ['Server version', server?.version ?? '—'],
      ['Server port', server?.port ?? '—'],
      ['Instance ID', server?.instanceId ?? '—'],
      ['PID', server?.pid ?? '—'],
      ['Data dir', server?.dataDirName ?? bridge?.dataDirName ?? '—'],
      ['Client build', server?.clientBuild ?? '—'],
      ['CDP URL', details?.cdpUrl ?? '—'],
      ['Active window title', details?.activeWindowTitle ?? '—'],
      ['Active git window key', gitSnapshots?.activeWindowKey ?? '—'],
      ['Git snapshots', snapshotSummary],
      ['Last git push', gitSnapshots?.lastPushAt ? new Date(Number(gitSnapshots.lastPushAt)).toLocaleString() : '—'],
      ['Last push window key', gitSnapshots?.lastPushWindowKey ?? '—'],
      ['State gitStatus', state.gitStatus ? `F:${state.gitStatus.changedCount}` : 'null'],
      ['Bridge git file', bridge?.gitStatusFileExists ? 'yes' : 'no'],
      ['Bridge git raw', bridge?.gitStatusRaw ?? '—'],
      ['Git bridge window', bridgeDebug?.windowName ?? '—'],
      ['Git bridge key', bridgeDebug?.windowKey ?? '—'],
      ['Git bridge owner', bridgeDebug?.isOwner == null ? '—' : String(bridgeDebug.isOwner)],
      ['Git bridge repos', bridgeDebug?.repoCount ?? '—'],
      ['Git bridge resolved', bridgeDebug?.repoResolved == null ? '—' : String(bridgeDebug.repoResolved)],
      ['Git repo breakdown', repoBreakdown],
      ['Git bridge count', bridgeDebug?.changedCount ?? '—'],
      ['Git push ok', bridgeDebug?.lastPushOk == null ? '—' : String(bridgeDebug.lastPushOk)],
      ['Git push error', bridgeDebug?.lastPushError ?? '—'],
      ['Git bridge error', bridgeDebug?.lastError ?? '—'],
      ['Stop selector', (details?.agentStopSelectorPath as string | undefined) ?? state.agentStopSelectorPath ?? '—'],
      ['Stop available', (details?.agentStopAvailable as boolean | undefined) == null ? String(state.agentStopAvailable) : String(details?.agentStopAvailable)],
      ['Stop source', (details?.agentStopSource as string | undefined) ?? state.agentStopSource ?? '—'],
      ['Activity source', (details?.agentActivitySource as string | undefined) ?? state.agentActivitySource ?? '—'],
      ['Client sendPending', String(sendPending)],
      ['Client stop enabled', String(clientStopState.stopEnabled)],
      ['Client real stop', String(clientStopState.realStopAvailable)],
      ['Generation', details?.generation ?? serverHealth?.generation ?? '—'],
      ['Uptime', details?.uptime ?? serverHealth?.uptime ?? '—'],
    ] as const;
  }, [details, sendPending, serverHealth, socketConnected, state]);

  const copyJson = useCallback(async () => {
    const payload = details ?? {
      client: { url: window.location.origin, socketConnected },
      health: serverHealth,
      stateGitStatus: state.gitStatus,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      ui.showToast('Debug JSON copied', 'success');
    } catch {
      ui.showToast('Copy failed', 'error');
    }
  }, [details, serverHealth, socketConnected, state.gitStatus, ui]);

  const killServer = useCallback(async () => {
    const result = await command.sendCommandAwaitResult('command:kill_server');
    if (!result.ok) {
      ui.showToast(result.error || 'Kill server failed', 'error');
      return;
    }
    ui.showToast('Server kill sent', 'success');
  }, [command, ui]);

  return (
    <div id="sheet-debug" className={`bottom-sheet debug-sheet ${visible ? '' : 'hidden'}`}>
      <div className="sheet-header debug-sheet-header">
        <span>Debug</span>
        <div className="debug-sheet-actions">
          <button type="button" className="debug-action-btn" disabled={loading} onClick={() => void loadDetails()}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button id="debug-kill-server" type="button" className="debug-action-btn" onClick={() => void killServer()}>
            Kill server
          </button>
          <button type="button" className="debug-action-btn" onClick={() => void copyJson()}>
            Copy JSON
          </button>
        </div>
      </div>
      {error && <div className="debug-error">{error}</div>}
      <div className="debug-sheet-body">
        {rows.map(([label, value]) => (
          <div key={label} className="debug-row">
            <span className="debug-row-label">{label}</span>
            <span className="debug-row-value">{String(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
