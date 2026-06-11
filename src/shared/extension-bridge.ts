import { join } from 'path';

export interface GitStatusInfo {
  available: boolean;
  changedCount: number;
  repoLabel?: string;
  updatedAt: number;
  source: 'vscode.git';
}

export interface OpenSourceControlRequest {
  requestId: string;
  requestedAt: number;
}

export interface OpenSourceControlResult {
  requestId: string;
  ok: boolean;
  completedAt: number;
  error?: string;
}

const GIT_STATUS_FILENAME = 'git-status.json';
const GIT_BRIDGE_DEBUG_FILENAME = 'git-bridge-debug.json';
const OPEN_SOURCE_CONTROL_REQUEST_FILENAME = 'open-source-control-request.json';
const OPEN_SOURCE_CONTROL_RESULT_FILENAME = 'open-source-control-result.json';

export function gitStatusBridgePath(dataDir: string): string {
  return join(dataDir, GIT_STATUS_FILENAME);
}

export function gitBridgeDebugPath(dataDir: string): string {
  return join(dataDir, GIT_BRIDGE_DEBUG_FILENAME);
}

export function openSourceControlRequestPath(dataDir: string): string {
  return join(dataDir, OPEN_SOURCE_CONTROL_REQUEST_FILENAME);
}

export function openSourceControlResultPath(dataDir: string): string {
  return join(dataDir, OPEN_SOURCE_CONTROL_RESULT_FILENAME);
}
