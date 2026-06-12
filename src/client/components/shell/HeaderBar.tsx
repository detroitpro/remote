import React, { useEffect, useRef, useState } from 'react';
import type { CursorState } from '../../../server/types.js';
import { sendStopAgent } from '../../actions/stopActions.js';
import { useCommandClient } from '../../state/commandClient.js';
import type { HealthSnapshot } from '../../state/serverHealth.js';
import { useUiState } from '../../state/uiState.js';
import { getConnectionUiState } from '../../view-models/connectionState.js';
import { buildStopButtonState } from '../../view-models/stopState.js';
import { StopAgentButton } from './StopAgentButton.js';

export interface HeaderBarProps {
  state: CursorState;
  socketConnected: boolean;
  serverHealth: HealthSnapshot | null;
  sendPending: boolean;
}

export function HeaderBar({
  state,
  socketConnected,
  serverHealth,
  sendPending,
}: HeaderBarProps) {
  const ui = useUiState();
  const command = useCommandClient();
  const [stopPending, setStopPending] = useState(false);
  const lastKnownStopSelectorRef = useRef('');
  const connection = getConnectionUiState(state, socketConnected);
  const labels: Record<string, string> = {
    idle: 'Idle',
    thinking: 'Thinking...',
    generating: 'Generating...',
    running_tool: 'Running tool...',
    waiting_approval: 'Needs approval',
    error: 'Error',
  };
  const activity = (state.agentActivityText || '').trim();
  const showActivity = state.agentActivityLive && activity && state.agentStatus !== 'idle';
  const rawStatusText = showActivity
    ? (activity.length > 56 ? `${activity.slice(0, 55)}...` : activity)
    : (labels[state.agentStatus] || state.agentStatus);
  const stopState = buildStopButtonState({
    state,
    sendPending,
    stopPending,
    lastKnownStopSelectorPath: lastKnownStopSelectorRef.current,
  });
  if (stopState.realStopAvailable && stopState.effectiveStopSelectorPath) {
    lastKnownStopSelectorRef.current = stopState.effectiveStopSelectorPath;
  }
  const stopEnabled = stopState.stopEnabled;
  const statusText = stopPending
    ? 'Stopping...'
    : sendPending && !showActivity && state.agentStatus === 'idle'
      ? 'Sending...'
      : rawStatusText;
  const statusStyle = state.agentStatus === 'waiting_approval'
    ? { color: 'var(--accent-yellow)' }
    : state.agentStatus === 'error'
      ? { color: 'var(--accent-red)' }
      : undefined;

  useEffect(() => {
    if (!stopPending) return;
    if (!stopState.realStopAvailable && !sendPending) {
      setStopPending(false);
      return;
    }
    const timer = window.setTimeout(() => setStopPending(false), 4000);
    return () => window.clearTimeout(timer);
  }, [sendPending, stopPending, stopState.realStopAvailable]);

  const handleStop = async () => {
    if (!stopEnabled) return;
    setStopPending(true);
    const result = await sendStopAgent(command);
    if (!result.ok) {
      setStopPending(false);
      ui.showToast(result.error || 'Stop failed', 'error');
    }
  };

  return (
    <header id="header">
      <div className="header-left">
        <span id="connection-dot" className={`dot ${connection.status}`} />
        <span id="connection-text">{connection.label}</span>
        {serverHealth?.server && (
          <button
            id="server-version-badge"
            type="button"
            className="server-version-badge"
            title="Open server debug panel"
            onClick={() => ui.openSheet('debug')}
          >
            v{serverHealth.server.version}:{serverHealth.server.port}
          </button>
        )}
      </div>
      <div className="header-right">
        <span id="agent-status-icon">
          {state.agentStatus === 'waiting_approval' ? '!' : state.agentStatus === 'error' ? 'x' : ''}
        </span>
        <span
          id="agent-status-text"
          className={!stopPending && (showActivity || sendPending) ? 'agent-status-shimmer' : ''}
          style={statusStyle}
        >
          {statusText}
        </span>
        <StopAgentButton disabled={!stopEnabled} onStop={() => void handleStop()} />
      </div>
    </header>
  );
}
