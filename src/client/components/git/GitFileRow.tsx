import React from 'react';
import type { GitFileSummary } from '../../../shared/git-scm.js';

function bucketBadge(bucket: GitFileSummary['bucket']): string {
  switch (bucket) {
    case 'staged': return 'S';
    case 'conflicts': return '!';
    case 'untracked': return '?';
    default: return 'M';
  }
}

export interface GitFileRowProps {
  file: GitFileSummary;
  onOpen: (file: GitFileSummary) => void;
  onStage: (file: GitFileSummary) => void;
  onUnstage: (file: GitFileSummary) => void;
}

export function GitFileRow({ file, onOpen, onStage, onUnstage }: GitFileRowProps) {
  const canStage = file.bucket === 'changes' || file.bucket === 'untracked';
  const canUnstage = file.bucket === 'staged';

  return (
    <div className="git-file-row">
      <button type="button" className="git-file-row-main" onClick={() => onOpen(file)}>
        <span className={`git-file-badge git-file-badge--${file.bucket}`}>{bucketBadge(file.bucket)}</span>
        <span className="git-file-path">{file.displayPath}</span>
        <span className="git-file-status">{file.status}</span>
      </button>
      <div className="git-file-row-actions">
        {canStage && (
          <button type="button" className="git-file-action" aria-label="Stage file" onClick={() => onStage(file)}>
            Stage
          </button>
        )}
        {canUnstage && (
          <button type="button" className="git-file-action" aria-label="Unstage file" onClick={() => onUnstage(file)}>
            Unstage
          </button>
        )}
      </div>
    </div>
  );
}
