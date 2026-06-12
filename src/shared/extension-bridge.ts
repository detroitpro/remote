import { join } from 'path';
import type { GitBridgeRepoDebugInfo } from './diagnostics.js';

export interface GitStatusInfo {
  available: boolean;
  changedCount: number;
  repoLabel?: string;
  updatedAt: number;
  source: 'vscode.git';
  /** Workspace identity this snapshot belongs to (per-window git). */
  windowKey?: string;
}

export interface GitWindowSnapshot {
  windowKey: string;
  gitStatus: GitStatusInfo;
  repoBreakdown?: GitBridgeRepoDebugInfo[];
  updatedAt: number;
  extensionInstanceId?: string;
}

export interface GitSnapshotPushPayload {
  windowKey: string;
  gitStatus: GitStatusInfo;
  repoBreakdown?: GitBridgeRepoDebugInfo[];
  updatedAt: number;
  extensionInstanceId?: string;
}

export const GIT_SNAPSHOT_PUSH_PATH = '/internal/git-snapshot';

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

const OPEN_SOURCE_CONTROL_REQUEST_FILENAME = 'open-source-control-request.json';
const OPEN_SOURCE_CONTROL_RESULT_FILENAME = 'open-source-control-result.json';

export function openSourceControlRequestPath(dataDir: string): string {
  return join(dataDir, OPEN_SOURCE_CONTROL_REQUEST_FILENAME);
}

export function openSourceControlResultPath(dataDir: string): string {
  return join(dataDir, OPEN_SOURCE_CONTROL_RESULT_FILENAME);
}
