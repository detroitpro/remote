import { useCallback } from 'react';

export function useTextareaAutosize(textareaRef: React.RefObject<HTMLTextAreaElement | null>) {
  return useCallback((options: { allowShrink?: boolean } = {}) => {
    const input = textareaRef.current;
    if (!input) return;

    const allowShrink = options.allowShrink === true;
    const maxHeight = 120;
    if (allowShrink || input.value.length === 0) {
      input.style.height = '';
    }

    const currentHeight = parseFloat(input.style.height || '0') || input.offsetHeight || 0;
    const desiredHeight = Math.min(input.scrollHeight, maxHeight);
    if (allowShrink || desiredHeight > currentHeight + 1) {
      input.style.height = `${desiredHeight}px`;
    }
    input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [textareaRef]);
}
