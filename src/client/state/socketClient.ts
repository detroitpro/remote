import { io, type Socket } from 'socket.io-client';

const AUTH_TOKEN_KEY = 'cursor-remote-token';

export type SocketLike = Pick<Socket, 'on' | 'emit'> & {
  connected?: boolean;
  connect?: () => SocketLike;
  off?: (event: string, listener?: (...args: unknown[]) => void) => SocketLike;
};

export function getAuthToken(): string {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function clearAuthToken(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // Ignore storage failures in embedded/browser test contexts.
  }
}

export async function checkAuth(): Promise<boolean> {
  try {
    const token = getAuthToken();
    const res = await fetch('/health', {
      credentials: 'same-origin',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return true;
    const data = await res.json();
    if (!data.authRequired) return true;
    if (data.sessionValid === true) return true;
    clearAuthToken();
    window.location.href = '/login';
    return false;
  } catch {
    return true;
  }
}

export function createSocket(): SocketLike {
  const testSocket = (globalThis as { __cursorRemoteMockSocket?: SocketLike }).__cursorRemoteMockSocket;
  if (testSocket) return testSocket;

  return io({
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    withCredentials: true,
    auth: cb => {
      try {
        cb({ token: getAuthToken() || '' });
      } catch {
        cb({ token: '' });
      }
    },
  });
}
