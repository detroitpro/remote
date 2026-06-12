import React from 'react';

export interface StopAgentButtonProps {
  disabled: boolean;
  onStop: () => void;
}

export function StopAgentButton({ disabled, onStop }: StopAgentButtonProps) {
  return (
    <button
      id="btn-agent-stop"
      className="agent-stop-btn"
      type="button"
      aria-label="Stop agent"
      disabled={disabled}
      onClick={onStop}
    >
      <span aria-hidden="true" />
    </button>
  );
}
