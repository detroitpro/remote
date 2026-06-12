import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Approval,
  ChatElement,
  CodeBlockItem,
  CursorState,
  PlanBlock,
  RunAction,
} from '../../../server/types.js';
import { useMessageScroll } from '../../hooks/useMessageScroll.js';
import { useNotifications } from '../../hooks/useNotifications.js';
import { useCommandClient } from '../../state/commandClient.js';
import { useUiState } from '../../state/uiState.js';
import { commandResultData } from '../../utils/commandResult.js';
import { plainTextToHtml, sanitizeHtml } from '../../utils/sanitizeHtml.js';
import { getConnectionUiState } from '../../view-models/connectionState.js';

function messageRenderKey(msg: ChatElement): string {
  try {
    return JSON.stringify(msg);
  } catch {
    return msg.id;
  }
}

export interface MessageViewportProps {
  state: CursorState;
  socketConnected: boolean;
}

export function MessageViewport({ state, socketConnected }: MessageViewportProps) {
  const messagesRef = useRef<HTMLElement | null>(null);
  const command = useCommandClient();
  const ui = useUiState();
  const connection = getConnectionUiState(state, socketConnected);
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

function NativeCodeBlock({ item, onFullscreen }: { item: CodeBlockItem; onFullscreen: () => void }) {
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
  const ui = useUiState();
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
          <button type="button" className="run-btn" onClick={() => void openPlan()}>View plan</button>
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
