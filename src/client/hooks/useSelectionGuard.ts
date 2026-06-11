import { useCallback } from 'react';

export function useSelectionGuard(containerRef: React.RefObject<HTMLElement | null>) {
  const hasActiveSelection = useCallback((): boolean => {
    const container = containerRef.current;
    const selection = window.getSelection ? window.getSelection() : null;
    if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) return false;

    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      if (
        container.contains(range.commonAncestorContainer) ||
        container.contains(range.startContainer) ||
        container.contains(range.endContainer)
      ) {
        return true;
      }
    }
    return false;
  }, [containerRef]);

  return { hasActiveSelection };
}
