import React from 'react';
import type { Approval } from '../../../server/types.js';
import { useCommandClient } from '../../state/commandClient.js';
import { useUiState } from '../../state/uiState.js';

function isGarbageActionLabel(label: string): boolean {
  return !label || /^accept$/i.test(label.trim());
}

function firstActionableApproval(approvals: Approval[]): Approval | null {
  return approvals.find(approval => approval.actions?.some(action => (
    action.selectorPath && (action.type === 'approve' || action.type === 'approve_all' || action.type === 'reject') && !isGarbageActionLabel(action.label)
  ))) || null;
}

function splitApprovalDescription(description: string): { title: string; command: string } {
  const command = (description || '').trim() || 'Command pending approval';
  const looksLikeShell = /(\&&|\|\||\||;|^cd\s|^npm\s|^npx\s|^git\s)/.test(command);
  if (!looksLikeShell) {
    return { title: command, command };
  }
  const tokenMatch = command.match(/\b(npm|npx|git|cd|curl|node|powershell)\b[^\n]*/i);
  const title = tokenMatch
    ? `Run ${tokenMatch[0].slice(0, 44)}${tokenMatch[0].length > 44 ? '…' : ''}`
    : 'Run shell command';
  return { title, command };
}

export function ApprovalBar({ approvals }: { approvals: Approval[] }) {
  const command = useCommandClient();
  const ui = useUiState();
  const approval = firstActionableApproval(approvals);
  if (!approval) {
    return <div id="approval-bar" className="approval-bar hidden" />;
  }
  const approve = approval.actions.find(action => action.type === 'approve' || action.type === 'approve_all');
  const reject = approval.actions.find(action => action.type === 'reject' && !isGarbageActionLabel(action.label));
  const { title, command: commandText } = splitApprovalDescription(approval.description);
  return (
    <div id="approval-bar" className="approval-bar">
      <div className="approval-card">
        <div className="approval-card-header">
          <span className="approval-card-icon" aria-hidden="true">▸</span>
          <span id="approval-desc" className="approval-card-title">{title}</span>
        </div>
        <pre className="approval-command-block">
          <span className="approval-command-prompt">$ </span>
          {commandText}
        </pre>
        <div className="approval-actions">
          <button
            id="btn-reject"
            className="btn btn-reject"
            disabled={!reject}
            onClick={() => {
              if (!reject) return;
              command.emit('command:reject', { approvalId: approval.id, selectorPath: reject.selectorPath });
              ui.showToast('Reject sent', 'success');
            }}
          >
            Reject
          </button>
          <button
            id="btn-approve"
            className="btn btn-approve"
            disabled={!approve}
            onClick={() => {
              if (!approve) return;
              command.emit('command:approve', { approvalId: approval.id, selectorPath: approve.selectorPath });
              ui.showToast('Approve sent', 'success');
            }}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
