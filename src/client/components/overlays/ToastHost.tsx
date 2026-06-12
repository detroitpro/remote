import React from 'react';
import { useUiState } from '../../state/uiState.js';

export function ToastHost() {
  const ui = useUiState();
  return (
    <div id="toast-container">
      {ui.toasts.map(toast => (
        <div key={toast.id} className={`toast ${toast.type || ''}`} onClick={() => ui.removeToast(toast.id)}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}
