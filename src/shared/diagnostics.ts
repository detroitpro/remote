import type { GitStatusInfo } from './extension-bridge.js';

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

export interface GitBridgeDebugInfo {
  updatedAt: number;
  extensionVersion: string;
  windowName: string;
  isOwner: boolean;
  gitApiAvailable: boolean;
  repoCount: number;
  repoResolved: boolean;
  repoLabel?: string;
  changedCount?: number;
  runGitStatus: boolean;
  lastError?: string;
}

export interface ServerDiagnostics {
  server: ServerIdentity;
  extensionBridge: ExtensionBridgeDiagnostics;
  gitStatus: GitStatusInfo | null;
  connected: boolean;
  generation: number;
  uptime: number;
  clients: number;
  activeWindowId: string;
  activeWindowTitle: string | null;
  cdpUrl: string;
}
