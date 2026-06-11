import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Approval,
  BackgroundTask,
  ChatElement,
  ChatTab,
  CodeBlockItem,
  CommandResult,
  ComposerQueueAction,
  ComposerQueueItem,
  CursorState,
  CursorWindow,
  PlanBlock,
  PlanModelOption,
  RunAction,
} from '../../server/types.js';
import { useMessageScroll } from '../hooks/useMessageScroll.js';
import { useTextareaAutosize } from '../hooks/useTextareaAutosize.js';
import { useNotifications } from '../hooks/useNotifications.js';
import { CommandClientContext, useCommandClient, useCreateCommandClient } from '../state/commandClient.js';
import { defaultCursorState, mergeCursorPatch, RemoteStateContext } from '../state/remoteStateStore.js';
import { checkAuth, clearAuthToken, createSocket, type SocketLike } from '../state/socketClient.js';
import { fetchDebugInfo, useServerHealth, type HealthSnapshot } from '../state/serverHealth.js';
import { UiStateContext, type SheetType, type ToastMessage } from '../state/uiState.js';
import { newCommandId } from '../utils/commandIds.js';
import { plainTextToHtml, sanitizeHtml } from '../utils/sanitizeHtml.js';

interface AppProps {
  socket?: SocketLike;
  skipAuth?: boolean;
}

const QUEUE_ACTION_LABELS: Record<string, string> = {
  send: 'Send now',
  remove: 'Remove',
  edit: 'Edit',
};

const MODE_OPTIONS = [
  { id: 'agent', label: 'Agent', icon: '∞' },
  { id: 'plan', label: 'Plan', icon: '☑' },
  { id: 'debug', label: 'Debug', icon: '🐛' },
  { id: 'chat', label: 'Ask', icon: '💬' },
];

function modeUi(modeId: string | undefined) {
  return MODE_OPTIONS.find(mode => mode.id === modeId) || {
    id: modeId || 'agent',
    label: modeId || 'Agent',
    icon: '',
  };
}

function messageRenderKey(msg: ChatElement): string {
  try {
    return JSON.stringify(msg);
  } catch {
    return msg.id;
  }
}

function commandResultData<T>(result: CommandResult): T | null {
  return (result.data ?? null) as T | null;
}

function getVisibleBackgroundTasks(state: CursorState): BackgroundTask[] {
  return (state.backgroundTasks || []).filter(task => !!task.stopSelectorPath);
}

function getVisibleGitStatus(state: CursorState) {
  return state.gitStatus?.available ? state.gitStatus : null;
}

export function App({ socket: providedSocket, skipAuth = false }: AppProps) {
  const socket = useMemo(() => providedSocket ?? createSocket(), [providedSocket]);
  const commandClient = useCreateCommandClient(socket);
  const [authReady, setAuthReady] = useState(skipAuth);
  const [socketConnected, setSocketConnected] = useState(socket.connected !== false);
  const [remoteState, setRemoteState] = useState<CursorState>(defaultCursorState);
  const [activeSheet, setActiveSheet] = useState<SheetType>(null);
  const [queueSheetItem, setQueueSheetItem] = useState<ComposerQueueItem | null>(null);
  const [tabSheetComposerId, setTabSheetComposerId] = useState<string | null>(null);
  const [planModelContext, setPlanModelContext] = useState<PlanBlock | null>(null);
  const [activePlanModal, setActivePlanModal] = useState<PlanBlock | null>(null);
  const [planModalBody, setPlanModalBody] = useState('');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((message: string, type?: 'success' | 'error') => {
    const id = newCommandId();
    setToasts(items => [...items, { id, message, type }]);
    window.setTimeout(() => {
      setToasts(items => items.filter(item => item.id !== id));
    }, 3500);
  }, []);

  useEffect(() => {
    if (skipAuth) return;
    let cancelled = false;
    void checkAuth().then(ok => {
      if (!cancelled) setAuthReady(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [skipAuth]);

  useEffect(() => {
    if (!authReady) return;

    let connectFailCount = 0;
    const onConnect = () => {
      connectFailCount = 0;
      setSocketConnected(true);
    };
    const onDisconnect = () => setSocketConnected(false);
    const onConnectError = (err: Error) => {
      connectFailCount++;
      if (err.message === 'Unauthorized' || connectFailCount >= 5) {
        clearAuthToken();
        window.location.href = '/login';
      }
    };
    const onStateFull = (newState: CursorState) => {
      setRemoteState({ ...defaultCursorState, ...newState });
    };
    const onStatePatch = (patch: Partial<CursorState>) => {
      setRemoteState(current => mergeCursorPatch(current, patch));
    };
    const onConnectionStatus = (data: { connected: boolean }) => {
      setRemoteState(current => ({ ...current, connected: data.connected }));
    };
    const onCommandResult = (result: CommandResult) => {
      if (!commandClient.resolveCommandResult(result) && !result.ok) {
        showToast(result.error || 'Command failed', 'error');
      }
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('state:full', onStateFull);
    socket.on('state:patch', onStatePatch);
    socket.on('connection:status', onConnectionStatus);
    socket.on('command:result', onCommandResult);
    socket.connect?.();

    return () => {
      socket.off?.('connect', onConnect);
      socket.off?.('disconnect', onDisconnect);
      socket.off?.('connect_error', onConnectError as (...args: unknown[]) => void);
      socket.off?.('state:full', onStateFull as (...args: unknown[]) => void);
      socket.off?.('state:patch', onStatePatch as (...args: unknown[]) => void);
      socket.off?.('connection:status', onConnectionStatus as (...args: unknown[]) => void);
      socket.off?.('command:result', onCommandResult as (...args: unknown[]) => void);
    };
  }, [authReady, commandClient, showToast, socket]);

  const ui = useMemo(() => ({
    activeSheet,
    queueSheetItem,
    tabSheetComposerId,
    planModelContext,
    activePlanModal,
    planModalBody,
    toasts,
    backgroundTaskContext: null,
    openSheet: (type: SheetType) => setActiveSheet(type),
    closeSheet: () => setActiveSheet(null),
    openQueueSheet: (item: ComposerQueueItem) => {
      setQueueSheetItem(item);
      setActiveSheet('queue');
    },
    openTabSheet: (composerId: string) => {
      setTabSheetComposerId(composerId);
      setActiveSheet('tab');
    },
    openPlanModelSheet: (plan: PlanBlock) => {
      setPlanModelContext(plan);
      setActiveSheet('plan-model');
    },
    openPlanModal: (plan: PlanBlock) => {
      setActivePlanModal(plan);
      setPlanModalBody('');
    },
    closePlanModal: () => {
      setActivePlanModal(null);
      setPlanModalBody('');
    },
    setPlanModalBody,
    showToast,
    removeToast: (id: string) => setToasts(items => items.filter(item => item.id !== id)),
  }), [activePlanModal, activeSheet, planModalBody, planModelContext, queueSheetItem, showToast, tabSheetComposerId, toasts]);

  if (!authReady) return null;

  return (
    <RemoteStateContext.Provider value={remoteState}>
      <CommandClientContext.Provider value={commandClient}>
        <UiStateContext.Provider value={ui}>
          <CursorRemoteShell state={remoteState} socketConnected={socketConnected} authReady={authReady} />
        </UiStateContext.Provider>
      </CommandClientContext.Provider>
    </RemoteStateContext.Provider>
  );
}

function CursorRemoteShell({ state, socketConnected, authReady }: { state: CursorState; socketConnected: boolean; authReady: boolean }) {
  const serverHealth = useServerHealth(authReady);
  return (
    <>
      <HeaderStatus state={state} socketConnected={socketConnected} serverHealth={serverHealth} />
      <ComposerQueueBar queue={state.composerQueue?.items || []} queueLabel={state.composerQueue?.queueLabel} />
      <WindowBar windows={state.windows || []} activeWindowId={state.activeWindowId} />
      <TabBar tabs={state.chatTabs || []} />
      <MessageViewport state={state} />
      <ApprovalBar approvals={state.pendingApprovals || []} />
      <QuestionnaireBar state={state} />
      <ComposerInput state={state} serverHealth={serverHealth} />
      <BottomSheetHost state={state} serverHealth={serverHealth} socketConnected={socketConnected} />
      <PlanModal />
      <ToastHost />
    </>
  );
}

function getConnectionUiState(state: CursorState, socketConnected: boolean) {
  const lastError = (state.lastExtractionError || '').trim();
  if (!socketConnected) {
    return {
      status: 'reconnecting',
      label: 'Connecting...',
      emptyPrimary: 'Relay disconnected.',
      emptyHint: 'Waiting for the CursorRemote server connection.',
    };
  }
  if (!state.connected) {
    return {
      status: 'reconnecting',
      label: 'Cursor disconnected',
      emptyPrimary: 'Cursor IDE is not connected.',
      emptyHint: 'Start Cursor with CDP enabled and keep the target window open.',
    };
  }
  if (state.extractorStatus === 'stale') {
    return {
      status: 'stale',
      label: 'Stale',
      emptyPrimary: 'No fresh Cursor state yet.',
      emptyHint: lastError ? `Last extractor error: ${lastError}` : 'Waiting for a fresh extraction.',
    };
  }
  return {
    status: 'connected',
    label: 'Connected',
    emptyPrimary: 'No messages in this chat yet.',
    emptyHint: 'Send a message below or switch chat tab / window in Cursor.',
  };
}

function HeaderStatus({ state, socketConnected, serverHealth }: { state: CursorState; socketConnected: boolean; serverHealth: HealthSnapshot | null }) {
  const ui = React.useContext(UiStateContext)!;
  const command = useCommandClient();
  const connection = getConnectionUiState(state, socketConnected);
  const labels: Record<string, string> = {
    idle: 'Idle',
    thinking: 'Thinking...',
    generating: 'Generating...',
    running_tool: 'Running tool...',
    waiting_approval: 'Needs approval',
    error: 'Error',
  };
  const activity = (state.agentActivityText || '').trim();
  const showActivity = state.agentActivityLive && activity && state.agentStatus !== 'idle';
  const statusText = showActivity
    ? (activity.length > 56 ? `${activity.slice(0, 55)}...` : activity)
    : (labels[state.agentStatus] || state.agentStatus);
  const headerRightClass = 'header-right';
  const stopSelectorPath = state.agentStopSelectorPath || state.backgroundTasks?.find(task => task.stopSelectorPath)?.stopSelectorPath || '';
  const hasActiveWork = state.agentActivityLive || state.agentStatus !== 'idle' || (state.backgroundTasks?.length || 0) > 0;
  const stopEnabled = hasActiveWork && !!stopSelectorPath;
  const statusStyle = state.agentStatus === 'waiting_approval'
    ? { color: 'var(--accent-yellow)' }
    : state.agentStatus === 'error'
      ? { color: 'var(--accent-red)' }
      : undefined;

  return (
    <header id="header">
      <div className="header-left">
        <span id="connection-dot" className={`dot ${connection.status}`} />
        <span id="connection-text">{connection.label}</span>
        {serverHealth?.server && (
          <button
            id="server-version-badge"
            type="button"
            className="server-version-badge"
            title="Open server debug panel"
            onClick={() => ui.openSheet('debug')}
          >
            v{serverHealth.server.version}:{serverHealth.server.port}
          </button>
        )}
      </div>
      <div className={headerRightClass}>
        <span id="agent-status-icon">{state.agentStatus === 'waiting_approval' ? '!' : state.agentStatus === 'error' ? 'x' : ''}</span>
        <span
          id="agent-status-text"
          className={showActivity ? 'agent-status-shimmer' : ''}
          style={statusStyle}
        >
          {statusText}
        </span>
        <button
          id="btn-agent-stop"
          className="agent-stop-btn"
          type="button"
          aria-label="Stop agent"
          disabled={!stopEnabled}
          onClick={() => {
            if (!stopEnabled) return;
            command.emit('command:click_action', { selectorPath: stopSelectorPath });
          }}
        >
          <span aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function ComposerQueueBar({ queue, queueLabel }: { queue: ComposerQueueItem[]; queueLabel?: string }) {
  const ui = React.useContext(UiStateContext)!;
  if (!queue.length) {
    return <div id="composer-queue-bar" className="composer-queue-bar hidden" aria-live="polite" />;
  }
  return (
    <div id="composer-queue-bar" className="composer-queue-bar" aria-live="polite">
      <div className="composer-queue-header">
        <span className="composer-queue-chevron" aria-hidden="true">&#9660;</span>
        <span id="composer-queue-label" className="composer-queue-label">{queueLabel || `${queue.length} queued`}</span>
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
            {!!item.actions?.length && <span className="composer-queue-menu-hint" aria-hidden="true">...</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function WindowBar({ windows, activeWindowId }: { windows: CursorWindow[]; activeWindowId: string }) {
  const command = useCommandClient();
  if (windows.length <= 1) {
    return <nav id="window-bar" className="window-bar hidden"><div id="window-list" className="window-list" /></nav>;
  }
  return (
    <nav id="window-bar" className="window-bar">
      <div id="window-list" className="window-list">
        {windows.map(win => (
          <button
            key={win.id}
            className={`window-item ${win.id === activeWindowId ? 'active' : ''}`}
            type="button"
            title={win.title || 'Window'}
            onClick={() => command.emit('command:switch_window', { windowId: win.id })}
          >
            {win.title || 'Window'}
          </button>
        ))}
      </div>
    </nav>
  );
}

function TabBar({ tabs }: { tabs: ChatTab[] }) {
  const command = useCommandClient();
  const ui = React.useContext(UiStateContext)!;
  const openTabs = tabs.filter(tab => tab.source === 'open');
  const sidebarTabs = tabs.filter(tab => tab.source !== 'open');
  const renderTab = (tab: ChatTab) => (
    <div
      key={`${tab.source}:${tab.composerId}:${tab.title}`}
      className={`tab-chip ${tab.isActive ? 'active' : ''}`}
    >
      <button
        type="button"
        className={`tab-item ${tab.isActive ? 'active' : ''}`}
        title={tab.title || 'Chat'}
        onClick={() => command.emit('command:switch_tab', {
          composerId: tab.composerId,
          selectorPath: tab.selectorPath,
          tabTitle: tab.title,
          tabSource: tab.source,
        })}
      >
        <span className={`tab-status ${tab.workStatus}`} aria-hidden="true" />
        <span className="tab-title">{tab.title || 'Chat'}</span>
      </button>
      <button
        type="button"
        className="tab-menu-btn"
        aria-label={`Actions for tab ${tab.title || 'Chat'}`}
        onClick={() => ui.openTabSheet(tab.composerId)}
      >
        ⋯
      </button>
    </div>
  );

  if (tabs.length <= 1) {
    return (
      <nav id="tab-bar" className="tab-bar hidden">
        <div id="tab-list" className="tab-list" />
        <button id="btn-new-chat" className="tab-new-btn" aria-label="New Chat">+</button>
      </nav>
    );
  }
  return (
    <nav id="tab-bar" className="tab-bar">
      <div id="tab-list" className="tab-list">
        {openTabs.length > 0 && (
          <>
            <span className="tab-group-label">Open</span>
            {openTabs.map(renderTab)}
          </>
        )}
        {openTabs.length > 0 && sidebarTabs.length > 0 && (
          <span className="tab-group-divider" aria-hidden="true" />
        )}
        {sidebarTabs.length > 0 && (
          <>
            <span className="tab-group-label">List</span>
            {sidebarTabs.map(renderTab)}
          </>
        )}
      </div>
      <button
        id="btn-new-chat"
        className="tab-new-btn"
        aria-label="New Chat"
        onClick={() => command.emit('command:new_chat')}
      >
        +
      </button>
    </nav>
  );
}

function MessageViewport({ state }: { state: CursorState }) {
  const messagesRef = useRef<HTMLElement | null>(null);
  const command = useCommandClient();
  const ui = React.useContext(UiStateContext)!;
  const connection = getConnectionUiState(state, true);
  const loadHistory = useCallback((times: number) => (
    command.sendCommandAwaitResult('command:load_history', { times })
  ), [command]);
  const { historyLoading, captureHistoryScrollPreserve, restoreHistoryScrollPreserve } = useMessageScroll(
    messagesRef,
    state.messages || [],
    state.activeComposerId,
    state.connected,
    loadHistory,
    ui.showToast,
  );
  useNotifications(state.messages || []);

  useEffect(() => {
    (window as unknown as { __cursorRemoteTestApi?: unknown }).__cursorRemoteTestApi = {
      captureHistoryScrollPreserve,
      restoreHistoryScrollPreserve,
    };
  }, [captureHistoryScrollPreserve, restoreHistoryScrollPreserve]);

  return (
    <main id="messages" ref={messagesRef} role="log" aria-live="polite">
      <div id="history-loader" className={`history-loader ${historyLoading ? '' : 'hidden'}`} aria-live="polite">
        Loading older messages...
      </div>
      {(state.messages || []).length === 0 ? (
        <EmptyState primary={connection.emptyPrimary} hint={connection.emptyHint} />
      ) : (
        <MessageList messages={state.messages || []} />
      )}
    </main>
  );
}

function EmptyState({ primary, hint }: { primary: string; hint: string }) {
  return (
    <div id="empty-state" className="empty-state">
      <p id="empty-state-primary">{primary}</p>
      <p id="empty-state-hint" className="hint" dangerouslySetInnerHTML={{ __html: sanitizeHtml(hint) }} />
    </div>
  );
}

function MessageList({ messages }: { messages: ChatElement[] }) {
  return (
    <>
      {messages.map(message => (
        <MessageRenderer key={message.id} message={message} />
      ))}
    </>
  );
}

const MessageRenderer = React.memo(function MessageRenderer({ message }: { message: ChatElement }) {
  switch (message.type) {
    case 'human':
      return <HumanMessage message={message} />;
    case 'assistant':
      return <AssistantMessage message={message} />;
    case 'tool':
      return <ToolMessage message={message} />;
    case 'thought':
      return <ThoughtMessage message={message} />;
    case 'plan':
      return <PlanMessage message={message} />;
    case 'todo_list':
      return <TodoListMessage message={message} />;
    case 'run_command':
      return <RunCommandMessage message={message} />;
    case 'loading':
      return <LoadingMessage message={message} />;
    default:
      return null;
  }
}, (prev, next) => messageRenderKey(prev.message) === messageRenderKey(next.message));

function HumanMessage({ message }: { message: Extract<ChatElement, { type: 'human' }> }) {
  return (
    <div className="chat-el el-human" data-id={message.id} data-msg-type={message.type}>
      <div className="human-bubble">
        {message.quoted?.text && (
          <div className="quoted-widget">
            <div className="quoted-label">Quoted</div>
            <div className="quoted-text">{message.quoted.text}</div>
          </div>
        )}
        {!!message.mentions?.length && (
          <div className="mentions-row">
            {message.mentions.map((mention, idx) => (
              <span key={`${mention.name}:${idx}`} className="mention-badge">{mention.name}</span>
            ))}
          </div>
        )}
        <div className="human-text">{message.text}</div>
      </div>
    </div>
  );
}

function AssistantMessage({ message }: { message: Extract<ChatElement, { type: 'assistant' }> }) {
  const html = message.html || plainTextToHtml(message.text || '');
  return (
    <div className="chat-el el-assistant" data-id={message.id} data-msg-type={message.type}>
      <div className="assistant-bubble">
        <div className="assistant-content markdown-body" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
        <NativeCodeBlocks codeBlocks={message.codeBlocks || []} />
      </div>
    </div>
  );
}

function NativeCodeBlocks({ codeBlocks }: { codeBlocks: CodeBlockItem[] }) {
  const [fullscreenBlock, setFullscreenBlock] = useState<CodeBlockItem | null>(null);
  const renderable = codeBlocks.filter(isRenderableCodeBlockItem);
  return (
    <>
      {renderable.map((block, index) => (
        <NativeCodeBlock key={`${block.filename || block.language || index}:${index}`} item={block} onFullscreen={() => setFullscreenBlock(block)} />
      ))}
      {fullscreenBlock && (
        <div className="code-block-fs-overlay" role="dialog" aria-modal="true" aria-label={fullscreenBlock.filename || 'Code'}>
          <div className="code-block-fs-backdrop" onClick={() => setFullscreenBlock(null)} />
          <div className="code-block-fs-panel">
            <div className="code-block-fs-panel-header">
              <span className="code-block-fs-title">{fullscreenBlock.filename || fullscreenBlock.language || 'Code'}</span>
              <button type="button" className="code-block-fs-close" aria-label="Close" onClick={() => setFullscreenBlock(null)}>x</button>
            </div>
            <div className="code-block-fs-scroll">
              <CodeBlockBody item={fullscreenBlock} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function isRenderableCodeBlockItem(item: CodeBlockItem): boolean {
  return !!(item && ((item.code || '').trim() || item.diffLines?.length));
}

function NativeCodeBlock({ item, onFullscreen }: { key?: React.Key; item: CodeBlockItem; onFullscreen: () => void }) {
  const title = (item.filename || item.language || '').trim();
  return (
    <div className="code-block native-code-block">
      <div className={`code-block-toolbar ${title ? '' : 'code-block-toolbar--actions-only'}`}>
        {title && <div className="code-block-header">{title}</div>}
        <button type="button" className="code-block-fullscreen-btn" aria-label="View full screen" onClick={onFullscreen}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg>
        </button>
      </div>
      <div className="code-block-viewport">
        <CodeBlockBody item={item} />
      </div>
    </div>
  );
}

function CodeBlockBody({ item }: { item: CodeBlockItem }) {
  if (item.blockKind === 'diff' && item.diffLines?.length) {
    return (
      <div className="code-block-diff-plain">
        {item.diffLines.map((line, index) => (
          <div key={index} className={`code-block-diff-line code-block-diff-line--${line.kind || 'ctx'}`}>
            {line.text}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="code-block-diff-plain code-block-diff-plain--raw">
      <pre><code>{item.code || ''}</code></pre>
    </div>
  );
}

function ToolMessage({ message }: { message: Extract<ChatElement, { type: 'tool' }> }) {
  return (
    <div className={`chat-el el-tool ${message.status === 'loading' ? 'loading' : ''}`} data-id={message.id} data-msg-type={message.type}>
      <div className={`tool-line ${message.status}`}>
        <span className="tool-icon">
          {message.status === 'completed' ? '✓' : <span className="tool-spinner" aria-hidden="true" />}
        </span>
        {message.summaryText ? (
          <span className="tool-summary">{message.summaryText}</span>
        ) : (
          <>
            {message.action && <span className="tool-action">{message.action}</span>}
            {message.details && <span className="tool-details">{message.details}</span>}
          </>
        )}
        {(message.filename || message.additions != null || message.deletions != null) && (
          <span className="tool-file-info">
            {message.filename && <span className="tool-filename">{message.filename}</span>}
            {message.additions != null && <span className="tool-additions">+{message.additions}</span>}
            {message.deletions != null && <span className="tool-deletions">-{message.deletions}</span>}
          </span>
        )}
      </div>
      {message.blocked && <div className="tool-blocked">{message.blocked}</div>}
      {message.diffBlock && <NativeCodeBlock item={message.diffBlock} onFullscreen={() => undefined} />}
      {!!message.actions?.length && <RunStyleActionButtons actions={message.actions} />}
    </div>
  );
}

function ThoughtMessage({ message }: { message: Extract<ChatElement, { type: 'thought' }> }) {
  const kindClass = message.thoughtKind === 'step_summary' ? 'thought-line-summary' : 'thought-line-step';
  return (
    <div className="chat-el el-thought" data-id={message.id} data-msg-type={message.type}>
      <div className={`thought-line ${kindClass}`}>{formatThoughtLine(message)}</div>
    </div>
  );
}

function formatThoughtLine(message: Extract<ChatElement, { type: 'thought' }>): string {
  const duration = (message.duration || '').trim();
  const detail = (message.detail || '').trim();
  if (message.thoughtKind === 'step_summary') {
    const action = (message.action || '').trim();
    return detail ? `${action || 'Steps'} — ${detail}` : (action || 'Steps');
  }
  if (message.thoughtKind === 'thinking_step') {
    const action = (message.action || '').trim();
    if (duration) return `${action || 'Step'} · ${duration}`;
    if (action) {
      if (/^thought$/i.test(action)) return 'Thought';
      if (/ing$/i.test(action)) return `${action.replace(/\.\.\.?$/, '')}…`;
      return action;
    }
    return 'Thinking…';
  }
  if (duration) return `Thought for ${duration}`;
  const action = (message.action || '').trim();
  if (action) {
    if (/^thought$/i.test(action)) return 'Thought';
    if (/ing$/i.test(action)) return `${action.replace(/\.\.\.?$/, '')}…`;
    return action;
  }
  return 'Thinking…';
}

function PlanMessage({ message }: { message: PlanBlock }) {
  const command = useCommandClient();
  const ui = React.useContext(UiStateContext)!;
  const openPlan = async () => {
    ui.openPlanModal(message);
    const result = await command.sendCommandAwaitResult('command:get_plan_full', { planLabel: message.label });
    if (result.ok) {
      const data = commandResultData<{ bodyHtml?: string; body?: string }>(result);
      ui.setPlanModalBody(data?.bodyHtml || plainTextToHtml(data?.body || ''));
    } else {
      ui.showToast(result.error || 'Failed to open plan', 'error');
    }
  };
  return (
    <div className="chat-el el-plan" data-id={message.id} data-msg-type={message.type}>
      <div className="plan-card">
        <div className="plan-card-header">
          <span className="plan-card-label">{message.label}</span>
          <span className="plan-card-progress">{message.todosCompleted}/{message.todosTotal}</span>
        </div>
        <div className="plan-card-title">{message.title}</div>
        {message.descriptionHtml
          ? <div className="plan-card-desc" dangerouslySetInnerHTML={{ __html: sanitizeHtml(message.descriptionHtml) }} />
          : message.description && <div className="plan-card-desc">{message.description}</div>}
        <TodoRows todos={message.todos || []} moreCount={message.todosMoreCount} />
        {message.model && (
          <button
            type="button"
            className="plan-card-model"
            disabled={!message.modelDropdownSelectorPath}
            onClick={() => message.modelDropdownSelectorPath ? ui.openPlanModelSheet(message) : undefined}
          >
            {message.model}
          </button>
        )}
        <div className="plan-card-actions">
          <button type="button" className="run-btn" onClick={openPlan}>View plan</button>
          {message.actions?.map(action => (
            <button
              key={`${action.type}:${action.selectorPath}`}
              type="button"
              className="run-btn"
              onClick={() => command.emit('command:click_action', { selectorPath: action.selectorPath })}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function TodoListMessage({ message }: { message: Extract<ChatElement, { type: 'todo_list' }> }) {
  return (
    <div className="chat-el el-todo-list" data-id={message.id} data-msg-type={message.type}>
      <div className="todo-card">
        <div className="todo-card-title">{message.title}</div>
        <div className="todo-card-progress">{message.todosCompleted}/{message.todosTotal}</div>
        <TodoRows todos={message.todos || []} />
      </div>
    </div>
  );
}

function TodoRows({ todos, moreCount }: { todos: { text: string; status: string }[]; moreCount?: number }) {
  return (
    <div className="todo-rows">
      {todos.map((todo, index) => (
        <div key={`${todo.text}:${index}`} className={`todo-row todo-row-${todo.status}`}>
          <span className="todo-status">{todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '-' : ''}</span>
          <span className="todo-text">{todo.text}</span>
        </div>
      ))}
      {!!moreCount && <div className="todo-row todo-row-more">{moreCount} more</div>}
    </div>
  );
}

function RunCommandMessage({ message }: { message: Extract<ChatElement, { type: 'run_command' }> }) {
  return (
    <div className="chat-el el-run-command" data-id={message.id} data-msg-type={message.type}>
      <div className="run-card">
        <div className="run-card-title">{message.description || 'Run command'}</div>
        {message.candidates && <div className="run-card-candidates">{message.candidates}</div>}
        <pre className="run-command-text">{message.command}</pre>
        <RunStyleActionButtons actions={message.actions || []} />
      </div>
    </div>
  );
}

function RunStyleActionButtons({ actions }: { actions: RunAction[] }) {
  const command = useCommandClient();
  if (!actions.length) return null;
  return (
    <div className="tool-actions-row">
      {actions.map(action => (
        <button
          key={`${action.type}:${action.selectorPath}`}
          type="button"
          className={`run-btn run-btn-${action.type}`}
          onClick={() => command.emit('command:click_action', { selectorPath: action.selectorPath })}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

function LoadingMessage({ message }: { message: Extract<ChatElement, { type: 'loading' }> }) {
  return (
    <div className="chat-el el-loading" data-id={message.id} data-msg-type={message.type}>
      <div className="loading-line">{message.text || 'Loading...'}</div>
    </div>
  );
}

function isGarbageActionLabel(label: string): boolean {
  return !label || /^accept$/i.test(label.trim());
}

function firstActionableApproval(approvals: Approval[]): Approval | null {
  return approvals.find(approval => approval.actions?.some(action => (
    action.selectorPath && (action.type === 'approve' || action.type === 'approve_all' || action.type === 'reject') && !isGarbageActionLabel(action.label)
  ))) || null;
}

function ApprovalBar({ approvals }: { approvals: Approval[] }) {
  const command = useCommandClient();
  const ui = React.useContext(UiStateContext)!;
  const approval = firstActionableApproval(approvals);
  if (!approval) {
    return <div id="approval-bar" className="approval-bar hidden" />;
  }
  const approve = approval.actions.find(action => action.type === 'approve' || action.type === 'approve_all');
  const reject = approval.actions.find(action => action.type === 'reject' && !isGarbageActionLabel(action.label));
  return (
    <div id="approval-bar" className="approval-bar">
      <div id="approval-desc" className="approval-desc">{approval.description}</div>
      <div className="approval-actions">
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
      </div>
    </div>
  );
}

function QuestionnaireBar({ state }: { state: CursorState }) {
  const command = useCommandClient();
  const ui = React.useContext(UiStateContext)!;
  const q = state.questionnaire;
  if (!q || !q.questions?.length) {
    return <div id="questionnaire-bar" className="questionnaire-bar hidden" />;
  }
  return (
    <div id="questionnaire-bar" className="questionnaire-bar">
      <div className="questionnaire-header">
        <span className="questionnaire-icon">?</span>
        <span className="questionnaire-title">Questions</span>
        <span id="questionnaire-stepper" className="questionnaire-stepper">{q.totalLabel}</span>
      </div>
      <div id="questionnaire-questions">
        {q.questions.map((question, index) => (
          <div key={`${question.number}:${index}`} className={`questionnaire-question ${question.isActive ? 'questionnaire-question-active' : ''}`}>
            <div className="questionnaire-question-text"><span>{question.number}</span> {question.text}</div>
            <div className="questionnaire-options">
              {question.options.map(option => (
                <button
                  key={`${option.letter}:${option.selectorPath}`}
                  type="button"
                  className="questionnaire-option"
                  onClick={() => {
                    command.emit('command:click_action', { selectorPath: option.selectorPath });
                    ui.showToast(`${option.letter} sent`, 'success');
                  }}
                >
                  <span className="questionnaire-option-letter">{option.letter}</span>
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="questionnaire-actions">
        <button
          id="btn-q-skip"
          className="btn btn-q-skip"
          onClick={() => command.emit('command:click_action', { selectorPath: q.skipSelectorPath })}
        >
          Skip
        </button>
        <button
          id="btn-q-continue"
          className="btn btn-q-continue"
          disabled={q.continueDisabled}
          onClick={() => command.emit('command:click_action', { selectorPath: q.continueSelectorPath })}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

interface PendingAttachment {
  id: string;
  mimeType: string;
  name: string;
  data: string;
  previewUrl: string;
}

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;

function ComposerInput({ state, serverHealth }: { state: CursorState; serverHealth: HealthSnapshot | null }) {
  const command = useCommandClient();
  const ui = React.useContext(UiStateContext)!;
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const autosize = useTextareaAutosize(inputRef);
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const inputDisabled = !state.inputAvailable;
  const canSend = !inputDisabled && (text.trim().length > 0 || attachments.length > 0);
  const currentMode = modeUi(state.mode?.current);
  const backgroundTasks = getVisibleBackgroundTasks(state);
  const gitStatus = getVisibleGitStatus(state);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const addImageFile = useCallback((file: File) => {
    if (!String(file.type || '').startsWith('image/')) {
      ui.showToast('Only images are supported', 'error');
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      ui.showToast('Image is too large (max 5 MB)', 'error');
      return;
    }
    if (attachments.length >= MAX_ATTACHMENTS) {
      ui.showToast('Maximum 5 attachments', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const comma = dataUrl.indexOf(',');
      if (comma < 0) {
        ui.showToast('Failed to read image', 'error');
        return;
      }
      setAttachments(items => [...items, {
        id: newCommandId(),
        mimeType: file.type,
        name: file.name || 'image',
        data: dataUrl.slice(comma + 1),
        previewUrl: dataUrl,
      }]);
    };
    reader.onerror = () => ui.showToast('Failed to read image', 'error');
    reader.readAsDataURL(file);
  }, [attachments.length, ui]);

  const sendMessage = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    command.emit('command:send_message', {
      ...(trimmed ? { text: trimmed } : {}),
      ...(attachments.length ? {
        attachments: attachments.map(att => ({ mimeType: att.mimeType, name: att.name, data: att.data })),
      } : {}),
    });
    setText('');
    clearAttachments();
    requestAnimationFrame(() => autosize({ allowShrink: true }));
    ui.showToast('Message sent', 'success');
  }, [attachments, autosize, clearAttachments, command, text, ui]);

  const handlePaste = useCallback((event: React.ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items || inputDisabled) return;
    let handled = false;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          handled = true;
          addImageFile(file);
        }
      }
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, [addImageFile, inputDisabled]);

  const openSourceControl = useCallback(async () => {
    if (!gitStatus) return;
    const result = await command.sendCommandAwaitResult('command:open_source_control');
    if (!result.ok) {
      ui.showToast(result.error || 'Failed to open Source Control', 'error');
    }
  }, [command, gitStatus, ui]);

  return (
    <footer id="input-bar">
      <div id="mode-model-bar" className="mode-model-bar">
        <button id="pill-mode" className="pill" aria-label="Select mode" onClick={() => ui.openSheet('mode')}>
          <span id="pill-mode-icon" className="pill-icon">{currentMode.icon}</span>
          <span id="pill-mode-text">{currentMode.label}</span>
          <span className="pill-chevron">&#9662;</span>
        </button>
        <button id="pill-model" className="pill" aria-label="Select model" onClick={() => ui.openSheet('model')}>
          <span id="pill-model-text">{state.model?.current || 'Auto'}</span>
          <span className="pill-chevron">&#9662;</span>
        </button>
        {gitStatus && (
          <button
            id="pill-git-status"
            className="git-status-pill"
            type="button"
            aria-label={`Open Source Control (${gitStatus.changedCount} changed file${gitStatus.changedCount === 1 ? '' : 's'})`}
            onClick={() => void openSourceControl()}
          >
            F:{gitStatus.changedCount}
          </button>
        )}
        {backgroundTasks.length > 0 && (
          <button
            id="pill-background-tasks"
            className="background-task-pill"
            type="button"
            aria-label={`${backgroundTasks.length} background task${backgroundTasks.length === 1 ? '' : 's'}`}
            onClick={() => ui.openSheet('background-tasks')}
          >
            B:{backgroundTasks.length}
          </button>
        )}
      </div>
      <div className="input-wrapper" onPaste={handlePaste}>
        <AttachmentStrip attachments={attachments} onRemove={id => setAttachments(items => items.filter(item => item.id !== id))} />
        <div className="input-row">
          <button
            id="btn-attach"
            className="btn btn-attach"
            type="button"
            disabled={inputDisabled}
            aria-label="Add image"
            onClick={() => fileRef.current?.click()}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <circle cx="8.5" cy="10" r="1.5" fill="currentColor" stroke="none" />
              <path d="M21 16l-5.5-5.5a1.5 1.5 0 0 0-2.12 0L3 18" />
            </svg>
          </button>
          <input
            id="attachment-file-input"
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="visually-hidden"
            tabIndex={-1}
            onChange={event => {
              Array.from(event.currentTarget.files || []).forEach(addImageFile);
              event.currentTarget.value = '';
            }}
          />
          <textarea
            id="message-input"
            ref={inputRef}
            placeholder="Send a message..."
            rows={1}
            disabled={inputDisabled}
            value={text}
            onChange={event => {
              setText(event.currentTarget.value);
              requestAnimationFrame(() => autosize());
            }}
            onPaste={handlePaste}
            onKeyDown={event => {
              if (event.key !== 'Enter') return;
              if (event.metaKey || event.ctrlKey) {
                event.preventDefault();
                sendMessage();
                return;
              }
              if (event.shiftKey || window.matchMedia('(pointer: coarse)').matches) return;
              event.preventDefault();
              sendMessage();
            }}
          />
          <button id="btn-send" className="btn btn-send" disabled={!canSend} aria-label="Send" onClick={sendMessage}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </div>
    </footer>
  );
}

function AttachmentStrip({ attachments, onRemove }: { attachments: PendingAttachment[]; onRemove: (id: string) => void }) {
  return (
    <div id="attachment-strip" className={`attachment-strip ${attachments.length ? '' : 'hidden'}`} aria-live="polite">
      {attachments.map(att => (
        <div key={att.id} className="attachment-chip" data-id={att.id}>
          <img src={att.previewUrl} alt={att.name || 'Attachment'} />
          <button type="button" className="attachment-remove" aria-label="Remove attachment" onClick={() => onRemove(att.id)}>x</button>
        </div>
      ))}
    </div>
  );
}

function BottomSheetHost({ state, serverHealth, socketConnected }: { state: CursorState; serverHealth: HealthSnapshot | null; socketConnected: boolean }) {
  const ui = React.useContext(UiStateContext)!;
  const active = ui.activeSheet;
  return (
    <>
      <div id="sheet-overlay" className={`sheet-overlay ${active ? '' : 'hidden'}`} onClick={ui.closeSheet} />
      <ModeSheet state={state} visible={active === 'mode'} />
      <ModelSheet state={state} visible={active === 'model'} />
      <PlanModelSheet visible={active === 'plan-model'} />
      <TabActionsSheet state={state} visible={active === 'tab'} />
      <QueueActionsSheet visible={active === 'queue'} />
      <BackgroundTasksSheet state={state} visible={active === 'background-tasks'} />
      <DebugSheet
        visible={active === 'debug'}
        state={state}
        serverHealth={serverHealth}
        socketConnected={socketConnected}
      />
    </>
  );
}

function ModeSheet({ state, visible }: { state: CursorState; visible: boolean }) {
  const command = useCommandClient();
  const ui = React.useContext(UiStateContext)!;
  const current = state.mode?.current || 'agent';
  return (
    <div id="sheet-mode" className={`bottom-sheet ${visible ? '' : 'hidden'}`}>
      <div className="sheet-header">Mode</div>
      <div id="sheet-mode-list" className="sheet-list">
        {MODE_OPTIONS.map(mode => (
          <button
            key={mode.id}
            className={`sheet-item ${mode.id === current ? 'selected' : ''}`}
            type="button"
            onClick={() => {
              command.emit('command:set_mode', { modeId: mode.id });
              ui.closeSheet();
              ui.showToast(`Mode: ${mode.label}`, 'success');
            }}
          >
            <span className="sheet-item-icon">{mode.icon}</span>
            <span>{mode.label}</span>
            {mode.id === current && <span className="sheet-item-check">✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function ModelSheet({ state, visible }: { state: CursorState; visible: boolean }) {
  const command = useCommandClient();
  const ui = React.useContext(UiStateContext)!;
  const [options, setOptions] = useState<PlanModelOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    void command.sendCommandAwaitResult('command:get_model_options').then(result => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        ui.showToast(result.error || 'Failed to load models', 'error');
        return;
      }
      const data = commandResultData<{ options?: PlanModelOption[] }>(result);
      setOptions(Array.isArray(data?.options) ? data.options : []);
    });
    return () => {
      cancelled = true;
    };
  }, [command, ui, visible]);

  return (
    <div id="sheet-model" className={`bottom-sheet ${visible ? '' : 'hidden'}`}>
      <div className="sheet-header">Model</div>
      <div id="sheet-model-list" className="sheet-list">
        {loading && <div className="sheet-item"><span>Loading...</span></div>}
        {!loading && options.length === 0 && <div className="sheet-item"><span>{state.model?.current || 'Auto'}</span></div>}
        {options.map(option => (
          <button
            key={option.id}
            type="button"
            className={`sheet-item ${option.selected ? 'active' : ''}`}
            onClick={() => {
              command.emit('command:set_model', { modelId: option.id });
              ui.closeSheet();
            }}
          >
            <span>{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PlanModelSheet({ visible }: { visible: boolean }) {
  const command = useCommandClient();
  const ui = React.useContext(UiStateContext)!;
  const plan = ui.planModelContext;
  const [options, setOptions] = useState<PlanModelOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !plan?.modelDropdownSelectorPath) return;
    let cancelled = false;
    setLoading(true);
    void command.sendCommandAwaitResult('command:get_plan_model_options', {
      selectorPath: plan.modelDropdownSelectorPath,
    }).then(result => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        ui.showToast(result.error || 'Failed to load plan models', 'error');
        return;
      }
      const data = commandResultData<{ options?: PlanModelOption[] }>(result);
      setOptions(Array.isArray(data?.options) ? data.options : []);
    });
    return () => {
      cancelled = true;
    };
  }, [command, plan?.modelDropdownSelectorPath, ui, visible]);

  return (
    <div id="sheet-plan-model" className={`bottom-sheet ${visible ? '' : 'hidden'}`}>
      <div id="sheet-plan-model-header" className="sheet-header">{plan?.title || 'Plan Model'}</div>
      <div id="sheet-plan-model-list" className="sheet-list">
        {loading && <div className="sheet-item"><span>Loading...</span></div>}
        {!loading && options.length === 0 && <div className="sheet-item"><span>{plan?.model || 'Auto'}</span></div>}
        {options.map(option => (
          <button
            key={option.id}
            type="button"
            className={`sheet-item ${option.selected ? 'active' : ''}`}
            onClick={() => {
              if (!plan?.modelDropdownSelectorPath) return;
              command.emit('command:set_plan_model', {
                selectorPath: plan.modelDropdownSelectorPath,
                planModelId: option.id,
              });
              ui.closeSheet();
            }}
          >
            <span>{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TabActionsSheet({ state, visible }: { state: CursorState; visible: boolean }) {
  const ui = React.useContext(UiStateContext)!;
  const command = useCommandClient();
  const tab = state.chatTabs.find(item => item.composerId === ui.tabSheetComposerId) || null;
  return (
    <div id="sheet-tab" className={`bottom-sheet ${visible ? '' : 'hidden'}`}>
      <div id="sheet-tab-header" className="sheet-header">{tab?.title || 'Tab'}</div>
      <div id="sheet-tab-list" className="sheet-list">
        {tab && (
          <>
            <button className="sheet-item" type="button" onClick={() => {
              command.emit('command:switch_tab', { composerId: tab.composerId, selectorPath: tab.selectorPath, tabTitle: tab.title, tabSource: tab.source });
              ui.closeSheet();
            }}>Open</button>
            <button className="sheet-item sheet-item-danger" type="button" onClick={() => {
              command.emit('command:close_tab', { composerId: tab.composerId, selectorPath: tab.selectorPath, tabTitle: tab.title, tabSource: tab.source });
              ui.closeSheet();
            }}>Close</button>
          </>
        )}
      </div>
    </div>
  );
}

function QueueActionsSheet({ visible }: { visible: boolean }) {
  const ui = React.useContext(UiStateContext)!;
  const command = useCommandClient();
  const item = ui.queueSheetItem;
  const actions = (item?.actions || []).filter(action => action.selectorPath);
  const order = ['send', 'edit', 'remove'];
  const sorted = actions.slice().sort((a, b) => {
    const ai = order.indexOf(a.type);
    const bi = order.indexOf(b.type);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  return (
    <div id="sheet-queue" className={`bottom-sheet ${visible ? '' : 'hidden'}`}>
      <div id="sheet-queue-header" className="sheet-header">{item?.text || 'Queue'}</div>
      <div id="sheet-queue-list" className="sheet-list">
        {sorted.length === 0 && <p className="sheet-tab-hint">No actions are available for this item.</p>}
        {sorted.map(action => (
          <QueueActionButton key={`${action.type}:${action.selectorPath}`} action={action} />
        ))}
      </div>
    </div>
  );

  function QueueActionButton({ action }: { key?: React.Key; action: ComposerQueueAction }) {
    const label = QUEUE_ACTION_LABELS[action.type] || action.label || action.type;
    return (
      <button
        className={`sheet-item ${action.type === 'remove' ? 'sheet-item-danger' : ''}`}
        type="button"
        onClick={() => {
          command.emit('command:click_action', { selectorPath: action.selectorPath });
          ui.closeSheet();
          ui.showToast(`${label}...`, 'success');
        }}
      >
        <span className="sheet-item-icon">{action.type === 'send' ? '^' : action.type === 'remove' ? 'x' : '*'}</span>
        <span>{label}</span>
      </button>
    );
  }
}

function BackgroundTasksSheet({ state, visible }: { state: CursorState; visible: boolean }) {
  const ui = React.useContext(UiStateContext)!;
  const command = useCommandClient();
  const tasks = getVisibleBackgroundTasks(state);
  return (
    <div id="sheet-background-tasks" className={`bottom-sheet ${visible ? '' : 'hidden'}`}>
      <div className="sheet-header">Background Tasks</div>
      <div id="sheet-background-tasks-list" className="sheet-list">
        {tasks.length === 0 && <p className="sheet-tab-hint">No background tasks are running.</p>}
        {tasks.map((task, index) => (
          <div key={task.id || index} className="background-task-sheet-item">
            <div className="background-task-sheet-main">
              <div className="background-task-sheet-title">{task.label || `Background task ${index + 1}`}</div>
              {task.detail && <div className="background-task-sheet-detail">{task.detail}</div>}
            </div>
            {task.stopSelectorPath ? (
              <button
                type="button"
                className="background-task-stop"
                onClick={() => {
                  command.emit('command:click_action', { selectorPath: task.stopSelectorPath });
                  ui.closeSheet();
                  ui.showToast('Stop sent', 'success');
                }}
              >
                Stop
              </button>
            ) : (
              <span className="background-task-no-action">No stop</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DebugSheet({
  visible,
  state,
  serverHealth,
  socketConnected,
}: {
  visible: boolean;
  state: CursorState;
  serverHealth: HealthSnapshot | null;
  socketConnected: boolean;
}) {
  const ui = React.useContext(UiStateContext)!;
  const command = useCommandClient();
  const [details, setDetails] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadDetails = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchDebugInfo() as Record<string, unknown>;
      setDetails(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    void loadDetails();
  }, [visible, loadDetails]);

  const rows = useMemo(() => {
    const bridge = details?.extensionBridge as Record<string, unknown> | undefined;
    const bridgeDebug = bridge?.gitBridgeDebug as Record<string, unknown> | undefined;
    const gitSnapshots = details?.gitSnapshots as Record<string, unknown> | undefined;
    const snapshotEntries = gitSnapshots?.windowSnapshots as Record<string, {
      changedCount: number;
      updatedAt: number;
      repoBreakdown?: Array<{ label: string; changedCount: number }>;
    }> | undefined;
    const snapshotSummary = snapshotEntries
      ? Object.entries(snapshotEntries)
        .map(([key, snap]) => `${key}:F:${snap.changedCount}`)
        .join(', ')
      : '—';
    const server = (details?.server ?? serverHealth?.server) as Record<string, unknown> | undefined;
    const repoBreakdown = Array.isArray(bridgeDebug?.repoBreakdown)
      ? bridgeDebug.repoBreakdown.map((repo: any) => `${repo.label}:${repo.changedCount}`).join(', ')
      : '—';
    return [
      ['Client URL', window.location.origin],
      ['Socket', socketConnected ? 'connected' : 'disconnected'],
      ['Server version', server?.version ?? '—'],
      ['Server port', server?.port ?? '—'],
      ['Instance ID', server?.instanceId ?? '—'],
      ['PID', server?.pid ?? '—'],
      ['Data dir', server?.dataDirName ?? bridge?.dataDirName ?? '—'],
      ['Client build', server?.clientBuild ?? '—'],
      ['CDP URL', details?.cdpUrl ?? '—'],
      ['Active window title', details?.activeWindowTitle ?? '—'],
      ['Active git window key', gitSnapshots?.activeWindowKey ?? '—'],
      ['Git snapshots', snapshotSummary],
      ['Last git push', gitSnapshots?.lastPushAt ? new Date(Number(gitSnapshots.lastPushAt)).toLocaleString() : '—'],
      ['Last push window key', gitSnapshots?.lastPushWindowKey ?? '—'],
      ['State gitStatus', state.gitStatus ? `F:${state.gitStatus.changedCount}` : 'null'],
      ['Bridge git file', bridge?.gitStatusFileExists ? 'yes' : 'no'],
      ['Bridge git raw', bridge?.gitStatusRaw ?? '—'],
      ['Git bridge window', bridgeDebug?.windowName ?? '—'],
      ['Git bridge key', bridgeDebug?.windowKey ?? '—'],
      ['Git bridge owner', bridgeDebug?.isOwner == null ? '—' : String(bridgeDebug.isOwner)],
      ['Git bridge repos', bridgeDebug?.repoCount ?? '—'],
      ['Git bridge resolved', bridgeDebug?.repoResolved == null ? '—' : String(bridgeDebug.repoResolved)],
      ['Git repo breakdown', repoBreakdown],
      ['Git bridge count', bridgeDebug?.changedCount ?? '—'],
      ['Git push ok', bridgeDebug?.lastPushOk == null ? '—' : String(bridgeDebug.lastPushOk)],
      ['Git push error', bridgeDebug?.lastPushError ?? '—'],
      ['Git bridge error', bridgeDebug?.lastError ?? '—'],
      ['Generation', details?.generation ?? serverHealth?.generation ?? '—'],
      ['Uptime', details?.uptime ?? serverHealth?.uptime ?? '—'],
    ] as const;
  }, [details, serverHealth, socketConnected, state.gitStatus]);

  const copyJson = useCallback(async () => {
    const payload = details ?? {
      client: { url: window.location.origin, socketConnected },
      health: serverHealth,
      stateGitStatus: state.gitStatus,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      ui.showToast('Debug JSON copied', 'success');
    } catch {
      ui.showToast('Copy failed', 'error');
    }
  }, [details, serverHealth, socketConnected, state.gitStatus, ui]);

  const killServer = useCallback(async () => {
    const result = await command.sendCommandAwaitResult('command:kill_server');
    if (!result.ok) {
      ui.showToast(result.error || 'Kill server failed', 'error');
      return;
    }
    ui.showToast('Server kill sent', 'success');
  }, [command, ui]);

  return (
    <div id="sheet-debug" className={`bottom-sheet debug-sheet ${visible ? '' : 'hidden'}`}>
      <div className="sheet-header debug-sheet-header">
        <span>Debug</span>
        <div className="debug-sheet-actions">
          <button type="button" className="debug-action-btn" disabled={loading} onClick={() => void loadDetails()}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button id="debug-kill-server" type="button" className="debug-action-btn" onClick={() => void killServer()}>
            Kill server
          </button>
          <button type="button" className="debug-action-btn" onClick={() => void copyJson()}>
            Copy JSON
          </button>
        </div>
      </div>
      {error && <div className="debug-error">{error}</div>}
      <div className="debug-sheet-body">
        {rows.map(([label, value]) => (
          <div key={label} className="debug-row">
            <span className="debug-row-label">{label}</span>
            <span className="debug-row-value">{String(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanModal() {
  const ui = React.useContext(UiStateContext)!;
  const plan = ui.activePlanModal;
  return (
    <div id="plan-modal-overlay" className={`plan-modal-overlay ${plan ? '' : 'hidden'}`} onClick={event => {
      if (event.target === event.currentTarget) ui.closePlanModal();
    }}>
      <div id="plan-modal" className="plan-modal" role="dialog" aria-modal="true" aria-labelledby="plan-modal-title">
        <div className="plan-modal-header">
          <div className="plan-modal-heading">
            <div id="plan-modal-label" className="plan-modal-label">{plan?.label || ''}</div>
            <div id="plan-modal-title" className="plan-modal-title">{plan?.title || ''}</div>
          </div>
          <button id="plan-modal-close" className="plan-modal-close" aria-label="Close plan" onClick={ui.closePlanModal}>x</button>
        </div>
        <div id="plan-modal-body" className="plan-modal-body" dangerouslySetInnerHTML={{ __html: sanitizeHtml(ui.planModalBody || plan?.descriptionHtml || plainTextToHtml(plan?.description || '')) }} />
      </div>
    </div>
  );
}

function ToastHost() {
  const ui = React.useContext(UiStateContext)!;
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
