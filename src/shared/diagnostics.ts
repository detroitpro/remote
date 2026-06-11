import type { GitStatusInfo, GitWindowSnapshot } from './extension-bridge.js';

export interface ServerIdentity {
  version: string;
  instanceId: string;
  pid: number;
  port: number;
  host: string;
  dataDirName: string;
  startedAt: number;
  clientBuild: 'vite-dev' | 'static';
}

export interface ExtensionBridgeDiagnostics {
  dataDirName: string;
  gitStatusFileExists: boolean;
  gitStatusFileMtime: number | null;
  gitStatusRaw: string | null;
  gitStatusParsed: GitStatusInfo | null;
  gitBridgeDebug: GitBridgeDebugInfo | null;
}

export interface GitBridgeRepoDebugInfo {
  rootUri: string;
  label: string;
  changedCount: number;
}

export interface GitBridgeDebugInfo {
  updatedAt: number;
  extensionVersion: string;
  windowName: string;
  windowKey?: string;
  isOwner: boolean;
  gitApiAvailable: boolean;
  repoCount: number;
  repoResolved: boolean;
  repoLabel?: string;
  changedCount?: number;
  repoBreakdown?: GitBridgeRepoDebugInfo[];
  runGitStatus: boolean;
  lastPushAt?: number;
  lastPushOk?: boolean;
  lastPushError?: string;
  lastError?: string;
}

export interface GitSnapshotStoreDiagnostics {
  activeWindowKey: string | null;
  activeWindowTitle: string | null;
  lastPushAt: number | null;
  lastPushWindowKey: string | null;
  windowSnapshots: Record<string, Pick<GitWindowSnapshot, 'windowKey' | 'updatedAt' | 'repoBreakdown'> & {
    changedCount: number;
    repoLabel?: string;
  }>;
}

export interface ServerDiagnostics {
  server: ServerIdentity;
  extensionBridge: ExtensionBridgeDiagnostics;
  gitSnapshots: GitSnapshotStoreDiagnostics;
  gitStatus: GitStatusInfo | null;
  connected: boolean;
  generation: number;
  uptime: number;
  clients: number;
  activeWindowId: string;
  activeWindowTitle: string | null;
  cdpUrl: string;
}
