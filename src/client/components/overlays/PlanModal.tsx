import React from 'react';
import { useUiState } from '../../state/uiState.js';
import { plainTextToHtml, sanitizeHtml } from '../../utils/sanitizeHtml.js';

export function PlanModal() {
  const ui = useUiState();
  const plan = ui.activePlanModal;
  return (
    <div
      id="plan-modal-overlay"
      className={`plan-modal-overlay ${plan ? '' : 'hidden'}`}
      onClick={event => {
        if (event.target === event.currentTarget) ui.closePlanModal();
      }}
    >
      <div id="plan-modal" className="plan-modal" role="dialog" aria-modal="true" aria-labelledby="plan-modal-title">
        <div className="plan-modal-header">
          <div className="plan-modal-heading">
            <div id="plan-modal-label" className="plan-modal-label">{plan?.label || ''}</div>
            <div id="plan-modal-title" className="plan-modal-title">{plan?.title || ''}</div>
          </div>
          <button id="plan-modal-close" className="plan-modal-close" aria-label="Close plan" onClick={ui.closePlanModal}>x</button>
        </div>
        <div
          id="plan-modal-body"
          className="plan-modal-body"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(ui.planModalBody || plan?.descriptionHtml || plainTextToHtml(plan?.description || '')) }}
        />
      </div>
    </div>
  );
}
