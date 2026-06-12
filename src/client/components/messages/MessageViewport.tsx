import React, { useCallback, useEffect, useRef } from 'react';
import type { CursorState } from '../../../server/types.js';
import { useMessageScroll } from '../../hooks/useMessageScroll.js';
import { useNotifications } from '../../hooks/useNotifications.js';
import { useCommandClient } from '../../state/commandClient.js';
import { useUiState } from '../../state/uiState.js';
import { sanitizeHtml } from '../../utils/sanitizeHtml.js';
import { getConnectionUiState } from '../../view-models/connectionState.js';
import { MessageList } from './messageTypes.js';

export interface MessageViewportProps {
  state: CursorState;
  socketConnected: boolean;
}

export function MessageViewport({ state, socketConnected }: MessageViewportProps) {
  const messagesRef = useRef<HTMLElement | null>(null);
  const command = useCommandClient();
  const ui = useUiState();
  const connection = getConnectionUiState(state, socketConnected);
  const loadHistory = useCallback((times: number) => (
    command.sendCommandAwaitResult('command:load_history', { times })
  ), [command]);
  const { historyLoading, captureHistoryScrollPreserve, restoreHistoryScrollPreserve } = useMessageScroll(
    messagesRef,
    state.messages || [],
    state.activeComposerId,
    state.connected,
    loadHistory,
    ui.showToast,
  );
  useNotifications(state.messages || []);

  useEffect(() => {
    (window as unknown as { __cursorRemoteTestApi?: unknown }).__cursorRemoteTestApi = {
      captureHistoryScrollPreserve,
      restoreHistoryScrollPreserve,
    };
  }, [captureHistoryScrollPreserve, restoreHistoryScrollPreserve]);

  return (
    <main id="messages" ref={messagesRef} role="log" aria-live="polite">
      <div id="history-loader" className={`history-loader ${historyLoading ? '' : 'hidden'}`} aria-live="polite">
        Loading older messages...
      </div>
      {(state.messages || []).length === 0 ? (
        <EmptyState primary={connection.emptyPrimary} hint={connection.emptyHint} />
      ) : (
        <MessageList messages={state.messages || []} />
      )}
    </main>
  );
}

function EmptyState({ primary, hint }: { primary: string; hint: string }) {
  return (
    <div id="empty-state" className="empty-state">
      <p id="empty-state-primary">{primary}</p>
      <p id="empty-state-hint" className="hint" dangerouslySetInnerHTML={{ __html: sanitizeHtml(hint) }} />
    </div>
  );
}
