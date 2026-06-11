import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { ChatElement, CommandResult } from '../../server/types.js';
import { useSelectionGuard } from './useSelectionGuard.js';

const HISTORY_TOP_THRESHOLD = 72;
const HISTORY_REARM_THRESHOLD = 160;
const HISTORY_LOAD_STEPS = 8;
const HISTORY_SUPPRESS_MS = 2500;

interface PreserveAnchor {
  id: string;
  offsetTop: number;
}

interface ScrollPreserve {
  anchor: PreserveAnchor | null;
  scrollHeightBefore: number;
  scrollTopBefore: number;
  beforeCount: number;
}

export function useMessageScroll(
  containerRef: RefObject<HTMLElement | null>,
  messages: ChatElement[],
  activeComposerId: string,
  connected: boolean,
  loadHistory: (times: number) => Promise<CommandResult>,
  showToast: (message: string, type?: 'success' | 'error') => void,
) {
  const [historyLoading, setHistoryLoading] = useState(false);
  const { hasActiveSelection } = useSelectionGuard(containerRef);
  const userScrolledUpRef = useRef(false);
  const historyTopArmedRef = useRef(false);
  const historySuppressUntilRef = useRef(Date.now() + HISTORY_SUPPRESS_MS);
  const preserveRef = useRef<ScrollPreserve | null>(null);
  const autoScrollJobRef = useRef(0);
  const trackedComposerRef = useRef(activeComposerId);
  const prevMessageCountRef = useRef(messages.length);
  const forceBottomRef = useRef(true);
  const touchStartYRef = useRef(0);

  const isNearBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
  }, [containerRef]);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const bottom = Math.max(0, el.scrollHeight - el.clientHeight);
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: bottom, behavior: 'instant' as ScrollBehavior });
    } else {
      el.scrollTop = bottom;
    }
  }, [containerRef]);

  const scheduleAutoScroll = useCallback((force = false) => {
    const jobId = ++autoScrollJobRef.current;
    const scrollAfterLayout = (remainingFrames: number) => {
      requestAnimationFrame(() => {
        if (jobId !== autoScrollJobRef.current) return;
        if (hasActiveSelection()) return;
        if (userScrolledUpRef.current) return;
        if (!force && !isNearBottom()) {
          userScrolledUpRef.current = true;
          return;
        }
        scrollToBottom();
        if (force && remainingFrames > 0) scrollAfterLayout(remainingFrames - 1);
      });
    };
    scrollAfterLayout(force ? 2 : 0);
  }, [hasActiveSelection, isNearBottom, scrollToBottom]);

  const findFirstVisibleMessageAnchor = useCallback((): PreserveAnchor | null => {
    const container = containerRef.current;
    if (!container) return null;
    const containerRect = container.getBoundingClientRect();
    const elements = Array.from(container.querySelectorAll('.chat-el')) as HTMLElement[];
    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom > containerRect.top && rect.top < containerRect.bottom) {
        return {
          id: el.dataset.id || '',
          offsetTop: rect.top - containerRect.top,
        };
      }
    }
    return null;
  }, [containerRef]);

  const captureHistoryScrollPreserve = useCallback((beforeCount: number): ScrollPreserve | null => {
    const container = containerRef.current;
    if (!container) return null;
    return {
      anchor: findFirstVisibleMessageAnchor(),
      scrollHeightBefore: container.scrollHeight,
      scrollTopBefore: container.scrollTop,
      beforeCount,
    };
  }, [containerRef, findFirstVisibleMessageAnchor]);

  const restoreHistoryScrollPreserve = useCallback((preserve: ScrollPreserve) => {
    const container = containerRef.current;
    if (!container) return;
    const anchor = preserve.anchor;
    if (anchor?.id) {
      const anchorEl = (Array.from(container.querySelectorAll('.chat-el')) as HTMLElement[])
        .find(el => el.dataset.id === anchor.id);
      if (anchorEl) {
        const containerTop = container.getBoundingClientRect().top;
        const anchorTop = anchorEl.getBoundingClientRect().top - containerTop;
        container.scrollTop += anchorTop - anchor.offsetTop;
        return;
      }
    }
    const delta = container.scrollHeight - preserve.scrollHeightBefore;
    container.scrollTop = preserve.scrollTopBefore + delta;
  }, [containerRef]);

  const requestOlderHistory = useCallback(async () => {
    if (historyLoading || !historyTopArmedRef.current || !connected) return;
    setHistoryLoading(true);
    historyTopArmedRef.current = false;
    userScrolledUpRef.current = true;
    autoScrollJobRef.current++;
    preserveRef.current = captureHistoryScrollPreserve(messages.length);

    const result = await loadHistory(HISTORY_LOAD_STEPS);
    setHistoryLoading(false);
    if (!result.ok) {
      preserveRef.current = null;
      showToast(result.error || 'Failed to load history', 'error');
      return;
    }
    const data = result.data as { addedCount?: number } | undefined;
    if (!data?.addedCount) {
      preserveRef.current = null;
      showToast('No older messages', 'success');
    }
  }, [captureHistoryScrollPreserve, connected, historyLoading, loadHistory, messages.length, showToast]);

  const maybeLoadOlderHistory = useCallback(() => {
    const container = containerRef.current;
    if (!container || Date.now() < historySuppressUntilRef.current) return;
    if (container.scrollTop > HISTORY_REARM_THRESHOLD) {
      historyTopArmedRef.current = true;
      return;
    }
    if (historyLoading || !historyTopArmedRef.current || !userScrolledUpRef.current || messages.length === 0) return;
    if (container.scrollTop > HISTORY_TOP_THRESHOLD) return;
    void requestOlderHistory();
  }, [containerRef, historyLoading, messages.length, requestOlderHistory]);

  useEffect(() => {
    if (activeComposerId && activeComposerId !== trackedComposerRef.current) {
      trackedComposerRef.current = activeComposerId;
      historyTopArmedRef.current = false;
      preserveRef.current = null;
      forceBottomRef.current = true;
      userScrolledUpRef.current = false;
      historySuppressUntilRef.current = Date.now() + HISTORY_SUPPRESS_MS;
    }
  }, [activeComposerId]);

  useEffect(() => {
    const preserve = preserveRef.current;
    if (preserve && messages.length > preserve.beforeCount) {
      requestAnimationFrame(() => {
        if (preserveRef.current === preserve) {
          restoreHistoryScrollPreserve(preserve);
          preserveRef.current = null;
        }
      });
    } else if (forceBottomRef.current) {
      forceBottomRef.current = false;
      userScrolledUpRef.current = false;
      scheduleAutoScroll(true);
    } else if (!userScrolledUpRef.current && !hasActiveSelection()) {
      scheduleAutoScroll(messages.length >= prevMessageCountRef.current);
    }
    prevMessageCountRef.current = messages.length;
  }, [hasActiveSelection, messages, restoreHistoryScrollPreserve, scheduleAutoScroll]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const markUserScrolledUp = () => {
      userScrolledUpRef.current = true;
      autoScrollJobRef.current++;
    };
    const onScroll = () => {
      autoScrollJobRef.current++;
      userScrolledUpRef.current = !isNearBottom();
      maybeLoadOlderHistory();
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        markUserScrolledUp();
        if (container.scrollTop < HISTORY_REARM_THRESHOLD) historyTopArmedRef.current = true;
      }
    };
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 1) touchStartYRef.current = event.touches[0].clientY;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      if (event.touches[0].clientY - touchStartYRef.current > 8) {
        markUserScrolledUp();
        if (container.scrollTop < HISTORY_REARM_THRESHOLD) historyTopArmedRef.current = true;
      }
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    container.addEventListener('wheel', onWheel, { passive: true });
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
    };
  }, [containerRef, isNearBottom, maybeLoadOlderHistory]);

  return {
    historyLoading,
    captureHistoryScrollPreserve,
    restoreHistoryScrollPreserve,
  };
}
