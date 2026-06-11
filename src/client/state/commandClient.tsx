import { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import type { CommandResult } from '../../server/types.js';
import type { SocketLike } from './socketClient.js';
import { newCommandId } from '../utils/commandIds.js';

type PendingResolver = (result: CommandResult) => void;

export interface CommandClient {
  emit(eventName: string, payload?: Record<string, unknown>): void;
  sendCommandAwaitResult(eventName: string, payload?: Record<string, unknown>): Promise<CommandResult>;
  resolveCommandResult(result: CommandResult): boolean;
  newCommandId(): string;
}

export const CommandClientContext = createContext<CommandClient | null>(null);

export function useCommandClient(): CommandClient {
  const client = useContext(CommandClientContext);
  if (!client) throw new Error('CommandClientContext is missing');
  return client;
}

export function useCreateCommandClient(socket: SocketLike): CommandClient {
  const pendingRef = useRef(new Map<string, PendingResolver>());

  const emit = useCallback((eventName: string, payload: Record<string, unknown> = {}) => {
    socket.emit(eventName, { commandId: newCommandId(), ...payload });
  }, [socket]);

  const sendCommandAwaitResult = useCallback((
    eventName: string,
    payload: Record<string, unknown> = {},
  ): Promise<CommandResult> => {
    const commandId = String(payload.commandId || newCommandId());
    return new Promise(resolve => {
      const timer = window.setTimeout(() => {
        pendingRef.current.delete(commandId);
        resolve({ commandId, ok: false, error: 'Command timed out' });
      }, 30000);

      pendingRef.current.set(commandId, result => {
        window.clearTimeout(timer);
        resolve(result);
      });

      socket.emit(eventName, { commandId, ...payload });
    });
  }, [socket]);

  const resolveCommandResult = useCallback((result: CommandResult): boolean => {
    const pending = pendingRef.current.get(result.commandId);
    if (!pending) return false;
    pendingRef.current.delete(result.commandId);
    pending(result);
    return true;
  }, []);

  return useMemo(() => ({
    emit,
    sendCommandAwaitResult,
    resolveCommandResult,
    newCommandId,
  }), [emit, sendCommandAwaitResult, resolveCommandResult]);
}
