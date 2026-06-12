import type { BackgroundTask, CursorState } from '../../server/types.js';
import type { GitStatusInfo } from '../../shared/extension-bridge.js';
import type { GitScmSnapshot } from '../../shared/git-scm.js';

export function getVisibleBackgroundTasks(state: CursorState): BackgroundTask[] {
  return state.backgroundTasks || [];
}

export function isForegroundWaitingBackgroundTask(task: BackgroundTask): boolean {
  return /^Waiting for \d+ commands? to finish$/i.test(task.label.trim());
}

export function getBackgroundTaskCount(tasks: BackgroundTask[]): number {
  const summaryRe = /^(\d+)\s+background\s+(?:terminal|task)s?$/i;
  const waitingRe = /^Waiting for (\d+) commands? to finish$/i;
  let maxSummaryCount = 0;
  let maxWaitingCount = 0;
  let detailedCount = 0;

  for (const task of tasks) {
    const label = task.label.trim();
    const summaryMatch = label.match(summaryRe);
    const waitingMatch = label.match(waitingRe);
    if (summaryMatch) {
      maxSummaryCount = Math.max(maxSummaryCount, parseInt(summaryMatch[1], 10));
    } else if (waitingMatch) {
      maxWaitingCount = Math.max(maxWaitingCount, parseInt(waitingMatch[1], 10));
    } else {
      detailedCount++;
    }
  }

  if (maxSummaryCount > 0 || maxWaitingCount > 0) {
    return Math.max(maxSummaryCount + maxWaitingCount, detailedCount, maxSummaryCount, maxWaitingCount);
  }
  return detailedCount;
}

export function getBackgroundTasksForSheet(tasks: BackgroundTask[]): BackgroundTask[] {
  return tasks.filter(task => !isForegroundWaitingBackgroundTask(task));
}

function gitStatusFromScm(scm: GitScmSnapshot): GitStatusInfo {
  const changedCount = scm.repos.reduce(
    (sum, repo) => sum
      + repo.counts.staged
      + repo.counts.changes
      + repo.counts.untracked
      + repo.counts.conflicts,
    0,
  );
  return {
    available: true,
    changedCount,
    repoLabel: scm.repos[0]?.label,
    updatedAt: scm.updatedAt,
    source: 'vscode.git',
    windowKey: scm.windowKey,
  };
}

export function getVisibleGitStatus(state: CursorState): GitStatusInfo | null {
  if (state.gitStatus?.available) {
    return state.gitStatus;
  }
  if (state.gitScm) {
    return gitStatusFromScm(state.gitScm);
  }
  return null;
}
