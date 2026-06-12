import type { CursorState } from '../../server/types.js';

export interface ConnectionUiState {
  status: 'connected' | 'reconnecting' | 'stale';
  label: string;
  emptyPrimary: string;
  emptyHint: string;
}

export function getConnectionUiState(state: CursorState, socketConnected: boolean): ConnectionUiState {
  const lastError = (state.lastExtractionError || '').trim();
  if (!socketConnected) {
    return {
      status: 'reconnecting',
      label: 'Connecting...',
      emptyPrimary: 'Relay disconnected.',
      emptyHint: 'Waiting for the CursorRemote server connection.',
    };
  }
  if (!state.connected) {
    return {
      status: 'reconnecting',
      label: 'Cursor disconnected',
      emptyPrimary: 'Cursor IDE is not connected.',
      emptyHint: 'Start Cursor with CDP enabled and keep the target window open.',
    };
  }
  if (state.extractorStatus === 'stale') {
    return {
      status: 'stale',
      label: 'Stale',
      emptyPrimary: 'No fresh Cursor state yet.',
      emptyHint: lastError ? `Last extractor error: ${lastError}` : 'Waiting for a fresh extraction.',
    };
  }
  return {
    status: 'connected',
    label: 'Connected',
    emptyPrimary: 'No messages in this chat yet.',
    emptyHint: 'Send a message below or switch chat tab / window in Cursor.',
  };
}
