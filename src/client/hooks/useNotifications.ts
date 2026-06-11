import { useEffect, useRef } from 'react';
import type { ChatElement } from '../../server/types.js';

export function useNotifications(messages: ChatElement[]) {
  const notifiedRef = useRef(new Set<string>());

  useEffect(() => {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    const latest = messages[messages.length - 1];
    if (!latest || latest.type !== 'assistant' || notifiedRef.current.has(latest.id)) return;
    notifiedRef.current.add(latest.id);
    new Notification('CursorRemote', { body: latest.text.slice(0, 120) });
  }, [messages]);
}
