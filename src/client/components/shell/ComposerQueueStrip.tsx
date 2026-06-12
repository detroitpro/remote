import React from 'react';
import type { ComposerQueueItem } from '../../../server/types.js';
import { useUiState } from '../../state/uiState.js';

export interface ComposerQueueStripProps {
  queue: ComposerQueueItem[];
  queueLabel?: string;
}

export function ComposerQueueStrip({ queue, queueLabel }: ComposerQueueStripProps) {
  const ui = useUiState();
  if (!queue.length) {
    return <div id="composer-queue-bar" className="composer-queue-bar hidden" aria-live="polite" />;
  }
  return (
    <div id="composer-queue-bar" className="composer-queue-bar" aria-live="polite">
      <div className="composer-queue-header">
        <span className="composer-queue-chevron" aria-hidden="true">&#9660;</span>
        <span id="composer-queue-label" className="composer-queue-label">
          {queueLabel || `${queue.length} queued`}
        </span>
      </div>
      <div id="composer-queue-items" className="composer-queue-items">
        {queue.map(item => (
          <button
            key={item.id}
            type="button"
            className="composer-queue-row"
            data-id={item.id}
            onClick={() => item.actions?.length ? ui.openQueueSheet(item) : undefined}
            onContextMenu={event => {
              event.preventDefault();
              ui.openQueueSheet(item);
            }}
          >
            <span className="composer-queue-dot" />
            <span className="composer-queue-text">{item.text}</span>
            {!!item.actions?.length && (
              <span className="composer-queue-menu-hint" aria-hidden="true">...</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
