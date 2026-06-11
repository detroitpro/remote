import { createContext, useContext } from 'react';
import type { BackgroundTask, ComposerQueueItem, PlanBlock } from '../../server/types.js';

export type SheetType = 'mode' | 'model' | 'plan-model' | 'tab' | 'queue' | 'background-tasks' | 'debug' | null;

export interface ToastMessage {
  id: string;
  message: string;
  type?: 'success' | 'error';
}

export interface UiState {
  activeSheet: SheetType;
  queueSheetItem: ComposerQueueItem | null;
  tabSheetComposerId: string | null;
  planModelContext: PlanBlock | null;
  activePlanModal: PlanBlock | null;
  planModalBody: string;
  toasts: ToastMessage[];
  backgroundTaskContext: BackgroundTask | null;
}

export interface UiActions {
  openSheet(type: SheetType): void;
  closeSheet(): void;
  openQueueSheet(item: ComposerQueueItem): void;
  openTabSheet(composerId: string): void;
  openPlanModelSheet(plan: PlanBlock): void;
  openPlanModal(plan: PlanBlock): void;
  closePlanModal(): void;
  setPlanModalBody(body: string): void;
  showToast(message: string, type?: 'success' | 'error'): void;
  removeToast(id: string): void;
}

export const UiStateContext = createContext<(UiState & UiActions) | null>(null);

export function useUiState(): UiState & UiActions {
  const value = useContext(UiStateContext);
  if (!value) throw new Error('UiStateContext is missing');
  return value;
}
