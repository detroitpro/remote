import type { GitSnapshotReason } from '../../src/shared/diagnostics.js';

export interface GitLocalStatusSummary {
  available: boolean;
  changedCount: number;
  repoLabel?: string;
  error?: string;
  reason?: GitSnapshotReason | null;
}

export function formatGitTreeItem(summary: GitLocalStatusSummary | null): {
  label: string;
  description?: string;
  icon: 'source-control' | 'warning';
} {
  if (!summary) {
    return { label: 'Git: initializing', icon: 'source-control' };
  }

  if (summary.available) {
    return {
      label: `Git changes: ${summary.changedCount}`,
      description: summary.repoLabel,
      icon: 'source-control',
    };
  }

  if (summary.error === 'vscode.git unavailable') {
    return { label: 'Git: extension unavailable', icon: 'warning' };
  }

  if (summary.error === 'no repository for workspace') {
    return { label: 'Git: no repository', icon: 'warning' };
  }

  return {
    label: 'Git: unavailable',
    description: summary.error ?? 'unknown',
    icon: 'warning',
  };
}

export function formatGitTooltipLine(summary: GitLocalStatusSummary | null): string | null {
  const item = formatGitTreeItem(summary);
  if (item.description) {
    return `${item.label} (${item.description})`;
  }
  return item.label;
}
