import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { CursorState } from '../../../../server/types.js';
import { useCommandClient } from '../../../state/commandClient.js';
import { fetchDebugInfo, type HealthSnapshot } from '../../../state/serverHealth.js';
import { useUiState } from '../../../state/uiState.js';
import { buildStopButtonState } from '../../../view-models/stopState.js';

export interface DebugSheetProps {
  visible: boolean;
  state: CursorState;
  serverHealth: HealthSnapshot | null;
  socketConnected: boolean;
  sendPending: boolean;
}

export function DebugSheet({
  visible,
  state,
  serverHealth,
  socketConnected,
  sendPending,
}: DebugSheetProps) {
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
