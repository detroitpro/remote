import { EventEmitter } from 'events';
import type { ChatElement, CursorState, CursorWindow } from './types.js';
import type { GitSnapshotPushPayload, GitStatusInfo, GitWindowSnapshot } from '../shared/extension-bridge.js';
import type { GitSnapshotStoreDiagnostics } from '../shared/diagnostics.js';
import { AGENT_ACTIVITY_STALE_MS, BACKGROUND_TASKS_STALE_MS } from './activity-stale.js';
import { filterActionableApprovals } from './approval-filter.js';
import { mergeMessages } from './message-history.js';

export function findGitSnapshotForTitle(
  windowTitle: string,
  snapshots: Map<string, GitWindowSnapshot>,
): GitWindowSnapshot | undefined {
  if (!windowTitle) return undefined;
  const exact = snapshots.get(windowTitle);
  if (exact) return exact;

  const normalizedTitle = windowTitle.toLowerCase();
  for (const [key, snapshot] of snapshots) {
    if (key.toLowerCase() === normalizedTitle) return snapshot;
  }

  const titleBase = windowTitle.split(' ')[0]?.toLowerCase();
  if (!titleBase) return undefined;
  for (const [key, snapshot] of snapshots) {
    const keyBase = key.split(' ')[0]?.toLowerCase();
    if (keyBase === titleBase) return snapshot;
  }
  return undefined;
}

function emptyState(): CursorState {
  return {
    connected: false,
    extractorStatus: 'idle',
    lastExtractionAt: null,
    consecutiveExtractionFailures: 0,
    lastExtractionError: null,
    agentStatus: 'idle',
    agentActivityText: null,
    agentActivityLive: false,
    agentActivitySource: 'none',
    messages: [],
    pendingApprovals: [],
    inputAvailable: false,
    chatTabs: [],
    activeComposerId: '',
    mode: { current: 'agent', available: [] },
    model: { current: 'Auto', currentId: '' },
    windows: [],
    activeWindowId: '',
    composerQueue: { items: [] },
    questionnaire: null,
    backgroundTasks: [],
    gitStatus: null,
    agentStopSelectorPath: '',
    agentStopAvailable: false,
    agentStopSource: 'none',
    exploratoryUi: null,
  };
}

export class StateManager extends EventEmitter {
  private currentState: CursorState = emptyState();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPatch: Partial<CursorState> | null = null;
  private debounceMs: number;
  private consecutiveNulls = 0;
  private readonly nullWarningThreshold = 10;
  private _generation = 0;
  /** When the current activity string first appeared (unchanged since). */
  private activityStableSince: number | null = null;
  private activityStableText: string | undefined = undefined;
  /**
   * After staleness clears `agentActivityText`, the DOM often keeps sending the same
   * string every poll; suppress that exact label until it changes or clears (Telegram
   * does not re-post activity when the snapshot is otherwise unchanged).
   */
  private activitySuppressedMatch: string | undefined = undefined;
  private backgroundTasksLastSeen: CursorState['backgroundTasks'] = [];
  private backgroundTasksLastSeenAt = 0;
  private historyScope = '';
  private messageHistory: ChatElement[] = [];
  private gitWindowSnapshots = new Map<string, GitWindowSnapshot>();
  private activeGitWindowKey: string | null = null;
  private lastGitPushAt: number | null = null;
  private lastGitPushWindowKey: string | null = null;

  get generation(): number {
    return this._generation;
  }

  constructor(debounceMs: number) {
    super();
    this.debounceMs = debounceMs;
  }

  getCurrentState(): CursorState {
    return this.currentState;
  }

  mergeStoredHistory(messages: ChatElement[]): { addedCount: number; totalCount: number } {
    if (messages.length === 0) {
      return { addedCount: 0, totalCount: this.currentState.messages.length };
    }

    const beforeIds = new Set(this.currentState.messages.map((message) => message.id));
    const merged = mergeMessages(messages, this.currentState.messages);
    const addedCount = merged.reduce(
      (count, message) => count + (beforeIds.has(message.id) ? 0 : 1),
      0
    );

    if (addedCount === 0 && merged.length === this.currentState.messages.length) {
      return { addedCount: 0, totalCount: this.currentState.messages.length };
    }

    this.messageHistory = merged;
    this.currentState = { ...this.currentState, messages: merged };
    this.emit('state:patch', { messages: merged });
    return { addedCount, totalCount: merged.length };
  }

  /**
   * Called by the DOM extractor on each poll cycle.
   * Diffs against previous state and emits patches.
   */
  onExtraction(newState: CursorState | null): void {
    if (newState === null) {
      this.onExtractionFailure('Extraction returned null');
      return;
    }

    this.consecutiveNulls = 0;
    this._generation++;
    // Preserve bridge-managed fields that the DOM extractor should not own.
    const now = Date.now();
    newState.connected = this.currentState.connected;
    newState.extractorStatus = this.currentState.connected ? 'ok' : 'idle';
    newState.lastExtractionAt = now;
    newState.consecutiveExtractionFailures = 0;
    newState.lastExtractionError = null;
    newState.windows = this.currentState.windows;
    newState.activeWindowId = this.currentState.activeWindowId;
    newState.gitStatus = this.currentState.gitStatus;
    newState.pendingApprovals = filterActionableApprovals(newState.pendingApprovals);
    if (newState.pendingApprovals.length === 0 && newState.agentStatus === 'waiting_approval') {
      newState.agentStatus = 'idle';
    }

    const historyScope = this.getHistoryScope(newState);
    const scopeChanged = historyScope !== this.historyScope;
    if (scopeChanged) {
      this.historyScope = historyScope;
      this.messageHistory = newState.messages.slice();
    } else {
      this.messageHistory = mergeMessages(this.messageHistory, newState.messages);
    }
    newState.messages = this.messageHistory;

    const stateForApply = this.applyBackgroundTaskStaleness(
      this.applyActivityStaleness(newState),
    );

    const patch = this.diff(this.currentState, stateForApply);
    if (!patch) return;

    this.currentState = stateForApply;
    this.schedulePatch(patch);
  }

  private getHistoryScope(state: CursorState): string {
    const activeTab =
      state.chatTabs.find((t) => t.isActive && t.source === 'open') ??
      state.chatTabs.find((t) => t.isActive);
    const tabComposerId = activeTab?.composerId ?? '';
    const tabTitle = (activeTab?.title ?? '').trim().replace(/\s+/g, ' ');
    return [
      state.activeWindowId,
      state.activeComposerId,
      tabComposerId,
      tabTitle,
    ].join('|');
  }

  onExtractionFailure(message: string | null): void {
    this.consecutiveNulls++;
    if (this.consecutiveNulls === this.nullWarningThreshold) {
      console.warn(
        `[state-manager] ${this.nullWarningThreshold} consecutive failed extractions. ` +
        'Selectors may need updating or the Cursor window may be background-throttled.'
      );
    }

    const connected = this.currentState.connected;
    const nextState: CursorState = {
      ...this.currentState,
      extractorStatus:
        connected && this.currentState.lastExtractionAt != null ? 'stale' : connected ? 'waiting' : 'idle',
      consecutiveExtractionFailures: this.currentState.consecutiveExtractionFailures + 1,
      lastExtractionError: message,
    };

    const patch = this.diff(this.currentState, nextState);
    if (!patch) return;
    this.currentState = nextState;
    this.schedulePatch(patch);
  }

  /**
   * Drop `agentActivityText` after AGENT_ACTIVITY_STALE_MS with no text change
   * (same semantics as Telegram's ephemeral activity deletion) so the web header
   * does not show "Thinking" forever when Telegram has already removed the line.
   */
  private applyActivityStaleness(newState: CursorState): CursorState {
    const text = newState.agentActivityText?.trim()
      ? newState.agentActivityText.trim()
      : null;

    if (!text) {
      this.activityStableSince = null;
      this.activityStableText = undefined;
      this.activitySuppressedMatch = undefined;
      if (newState.agentActivityText === null || newState.agentActivityText === '') {
        return newState;
      }
      return {
        ...newState,
        agentActivityText: null,
        agentActivityLive: false,
        agentActivitySource: 'none',
      };
    }

    if (
      this.activitySuppressedMatch != null &&
      text === this.activitySuppressedMatch
    ) {
      return {
        ...newState,
        agentStatus:
          newState.agentStatus === 'waiting_approval' || newState.agentStatus === 'error'
            ? newState.agentStatus
            : 'idle',
        agentActivityText: null,
        agentActivityLive: false,
        agentActivitySource: 'none',
      };
    }

    if (this.activitySuppressedMatch != null && text !== this.activitySuppressedMatch) {
      this.activitySuppressedMatch = undefined;
    }

    const now = Date.now();
    if (text === this.activityStableText && this.activityStableSince != null) {
      if (now - this.activityStableSince >= AGENT_ACTIVITY_STALE_MS) {
        this.activityStableSince = null;
        this.activityStableText = undefined;
        this.activitySuppressedMatch = text;
        return {
          ...newState,
          agentStatus:
            newState.agentStatus === 'waiting_approval' || newState.agentStatus === 'error'
              ? newState.agentStatus
              : 'idle',
          agentActivityText: null,
          agentActivityLive: false,
          agentActivitySource: 'none',
        };
      }
      return newState;
    }

    this.activityStableText = text;
    this.activityStableSince = now;
    return newState;
  }

  private applyBackgroundTaskStaleness(newState: CursorState): CursorState {
    const nextTasks = newState.backgroundTasks || [];
    if (nextTasks.length > 0) {
      this.backgroundTasksLastSeen = nextTasks;
      this.backgroundTasksLastSeenAt = Date.now();
      return newState;
    }

    if (this.backgroundTasksLastSeen.length === 0) {
      return newState;
    }

    const agentBusy =
      newState.agentStatus === 'generating' ||
      newState.agentStatus === 'running_tool' ||
      newState.agentStatus === 'thinking';
    const withinHold = Date.now() - this.backgroundTasksLastSeenAt < BACKGROUND_TASKS_STALE_MS;
    if (agentBusy && withinHold) {
      return { ...newState, backgroundTasks: this.backgroundTasksLastSeen };
    }

    this.backgroundTasksLastSeen = [];
    this.backgroundTasksLastSeenAt = 0;
    return newState;
  }

  onConnectionChanged(connected: boolean): void {
    const nextState: CursorState = {
      ...this.currentState,
      connected,
      extractorStatus: connected ? 'waiting' : 'idle',
      lastExtractionAt: null,
      consecutiveExtractionFailures: 0,
      lastExtractionError: null,
    };
    const patch = this.diff(this.currentState, nextState);
    if (!patch) return;
    this.currentState = nextState;
    this.emit('state:patch', patch);
    this.emit('connection:changed', connected);
  }

  updateWindows(windows: CursorWindow[], activeWindowId: string): void {
    const windowsChanged = JSON.stringify(this.currentState.windows) !== JSON.stringify(windows);
    const activeChanged = this.currentState.activeWindowId !== activeWindowId;
    if (!windowsChanged && !activeChanged) return;

    this.currentState = { ...this.currentState, windows, activeWindowId };
    const gitPatch = this.syncGitStatusForActiveWindow();
    const patch: Partial<CursorState> = { windows, activeWindowId };
    if (gitPatch) patch.gitStatus = gitPatch;
    this.emit('state:patch', patch);
  }

  /** Push per-window mode/model into global state (e.g. from a cached snapshot on window switch). */
  updateModeModel(mode: CursorState['mode'], model: CursorState['model']): void {
    const modeChanged = this.currentState.mode?.current !== mode?.current;
    const modelChanged = this.currentState.model?.current !== model?.current
      || this.currentState.model?.currentId !== model?.currentId;
    if (!modeChanged && !modelChanged) return;
    const patch: Partial<CursorState> = {};
    if (modeChanged) patch.mode = mode;
    if (modelChanged) patch.model = model;
    this.currentState = { ...this.currentState, ...patch };
    this.emit('state:patch', patch);
  }

  updateGitStatus(gitStatus: GitStatusInfo | null): void {
    if (JSON.stringify(this.currentState.gitStatus) === JSON.stringify(gitStatus)) return;
    this.currentState = { ...this.currentState, gitStatus };
    this.emit('state:patch', { gitStatus });
  }

  upsertGitWindowSnapshot(payload: GitSnapshotPushPayload): GitStatusInfo | null {
    const snapshot: GitWindowSnapshot = {
      windowKey: payload.windowKey,
      gitStatus: { ...payload.gitStatus, windowKey: payload.windowKey },
      repoBreakdown: payload.repoBreakdown,
      updatedAt: payload.updatedAt,
      extensionInstanceId: payload.extensionInstanceId,
    };
    this.gitWindowSnapshots.set(payload.windowKey, snapshot);
    this.lastGitPushAt = Date.now();
    this.lastGitPushWindowKey = payload.windowKey;
    const gitStatus = this.syncGitStatusForActiveWindow();
    if (gitStatus !== undefined) {
      this.emit('state:patch', { gitStatus: gitStatus ?? null });
    }
    return gitStatus ?? null;
  }

  getGitSnapshotDiagnostics(activeWindowTitle: string | null): GitSnapshotStoreDiagnostics {
    const windowSnapshots: GitSnapshotStoreDiagnostics['windowSnapshots'] = {};
    for (const [key, snapshot] of this.gitWindowSnapshots) {
      windowSnapshots[key] = {
        windowKey: snapshot.windowKey,
        changedCount: snapshot.gitStatus.changedCount,
        repoLabel: snapshot.gitStatus.repoLabel,
        updatedAt: snapshot.updatedAt,
        repoBreakdown: snapshot.repoBreakdown,
      };
    }
    return {
      activeWindowKey: this.activeGitWindowKey,
      activeWindowTitle,
      lastPushAt: this.lastGitPushAt,
      lastPushWindowKey: this.lastGitPushWindowKey,
      windowSnapshots,
    };
  }

  private syncGitStatusForActiveWindow(): GitStatusInfo | null | undefined {
    const activeWindow = this.currentState.windows.find(
      window => window.id === this.currentState.activeWindowId,
    );
    const snapshot = activeWindow
      ? findGitSnapshotForTitle(activeWindow.title, this.gitWindowSnapshots)
      : undefined;
    this.activeGitWindowKey = snapshot?.windowKey ?? null;
    const nextGitStatus = snapshot?.gitStatus ?? null;
    if (JSON.stringify(this.currentState.gitStatus) === JSON.stringify(nextGitStatus)) {
      return undefined;
    }
    this.currentState = { ...this.currentState, gitStatus: nextGitStatus };
    return nextGitStatus;
  }

  private diff(
    prev: CursorState,
    next: CursorState
  ): Partial<CursorState> | null {
    const patch: Partial<CursorState> = {};
    let hasChange = false;

    if (prev.connected !== next.connected) {
      patch.connected = next.connected;
      hasChange = true;
    }

    if (prev.extractorStatus !== next.extractorStatus) {
      patch.extractorStatus = next.extractorStatus;
      hasChange = true;
    }

    if (prev.lastExtractionAt !== next.lastExtractionAt) {
      patch.lastExtractionAt = next.lastExtractionAt;
      hasChange = true;
    }

    if (prev.consecutiveExtractionFailures !== next.consecutiveExtractionFailures) {
      patch.consecutiveExtractionFailures = next.consecutiveExtractionFailures;
      hasChange = true;
    }

    if (prev.lastExtractionError !== next.lastExtractionError) {
      patch.lastExtractionError = next.lastExtractionError;
      hasChange = true;
    }

    if (prev.agentStatus !== next.agentStatus) {
      patch.agentStatus = next.agentStatus;
      hasChange = true;
    }

    if (prev.agentActivityText !== next.agentActivityText) {
      patch.agentActivityText = next.agentActivityText;
      hasChange = true;
    }

    if (prev.agentActivityLive !== next.agentActivityLive) {
      patch.agentActivityLive = next.agentActivityLive;
      hasChange = true;
    }

    if (prev.agentActivitySource !== next.agentActivitySource) {
      patch.agentActivitySource = next.agentActivitySource;
      hasChange = true;
    }

    if (prev.inputAvailable !== next.inputAvailable) {
      patch.inputAvailable = next.inputAvailable;
      hasChange = true;
    }

    if (JSON.stringify(prev.messages) !== JSON.stringify(next.messages)) {
      patch.messages = next.messages;
      hasChange = true;
    }

    if (JSON.stringify(prev.pendingApprovals) !== JSON.stringify(next.pendingApprovals)) {
      patch.pendingApprovals = next.pendingApprovals;
      hasChange = true;
    }

    if (JSON.stringify(prev.chatTabs) !== JSON.stringify(next.chatTabs)) {
      patch.chatTabs = next.chatTabs;
      hasChange = true;
    }

    if (prev.mode?.current !== next.mode?.current) {
      patch.mode = next.mode;
      hasChange = true;
    }

    if (prev.model?.current !== next.model?.current || prev.model?.currentId !== next.model?.currentId) {
      patch.model = next.model;
      hasChange = true;
    }

    if (JSON.stringify(prev.windows) !== JSON.stringify(next.windows)) {
      patch.windows = next.windows;
      hasChange = true;
    }

    if (prev.activeWindowId !== next.activeWindowId) {
      patch.activeWindowId = next.activeWindowId;
      hasChange = true;
    }

    if (JSON.stringify(prev.composerQueue) !== JSON.stringify(next.composerQueue)) {
      patch.composerQueue = next.composerQueue;
      hasChange = true;
    }

    if (JSON.stringify(prev.questionnaire) !== JSON.stringify(next.questionnaire)) {
      patch.questionnaire = next.questionnaire;
      hasChange = true;
    }

    if (JSON.stringify(prev.backgroundTasks) !== JSON.stringify(next.backgroundTasks)) {
      patch.backgroundTasks = next.backgroundTasks;
      hasChange = true;
    }

    if (JSON.stringify(prev.gitStatus) !== JSON.stringify(next.gitStatus)) {
      patch.gitStatus = next.gitStatus;
      hasChange = true;
    }

    if (prev.agentStopSelectorPath !== next.agentStopSelectorPath) {
      patch.agentStopSelectorPath = next.agentStopSelectorPath;
      hasChange = true;
    }

    return hasChange ? patch : null;
  }

  private schedulePatch(patch: Partial<CursorState>): void {
    this.pendingPatch = this.pendingPatch
      ? { ...this.pendingPatch, ...patch }
      : patch;

    if (!this.debounceTimer) {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        if (this.pendingPatch) {
          this.emit('state:patch', this.pendingPatch);
          this.pendingPatch = null;
        }
      }, this.debounceMs);
    }
  }
}
