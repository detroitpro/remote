import type { Approval } from './types.js';

/** Shell/Task cards with "Run in background" are not blocking approvals. */
export function isBackgroundApprovalLabel(label: string): boolean {
  const norm = label.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!norm) return false;
  if (norm.includes('background')) return true;
  return /run\s+in\s+back(?:ground)?/.test(norm);
}

/** Action buttons should have short human labels, not shell output or source code. */
export function looksLikeButtonLabel(label: string): boolean {
  const norm = label.replace(/\s+/g, ' ').trim();
  if (!norm || norm.length > 48) return false;
  if (/[{}\[\];]/.test(norm)) return false;
  if (/\/\/|\/\*|\*\//.test(norm)) return false;
  if (/\b(function|const|let|var|catch|syncopen|chatTabs)\b/i.test(norm)) return false;
  if (/^\+\s*\+/.test(norm)) return false;
  return true;
}

export function isGarbageActionLabel(label: string): boolean {
  if (!looksLikeButtonLabel(label)) return true;
  const norm = label.replace(/\s+/g, ' ').trim();
  if (/#\s*fail\b/i.test(norm)) return true;
  if (/\bduration_ms\b/i.test(norm)) return true;
  if (/#\s*(cancelled|skipped|todo)\s+\d+/i.test(norm)) return true;
  return false;
}

export function isActionableApproval(approval: Pick<Approval, 'description' | 'actions'>): boolean {
  const approves = approval.actions.filter(
    (a) => a.type === 'approve' || a.type === 'approve_all'
  );
  if (approves.length === 0) return false;
  if (isBackgroundApprovalLabel(approval.description)) return false;
  if (approves.every((a) => isBackgroundApprovalLabel(a.label))) return false;
  if (!approves.some((a) => looksLikeButtonLabel(a.label))) return false;
  return true;
}

export function filterActionableApprovals(approvals: Approval[]): Approval[] {
  return approvals.filter((entry) => isActionableApproval(entry));
}
