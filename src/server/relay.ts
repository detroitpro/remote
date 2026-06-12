import express from 'express';
import { createServer } from 'http';
import { createRequire } from 'module';
import { Server as SocketServer, type Socket } from 'socket.io';
import { basename, join, resolve } from 'path';
import { randomBytes, timingSafeEqual } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import type { ServerConfig, CursorState, CommandPayload, CommandResult } from './types.js';
import { waitForFreshExtraction } from './extraction-wait.js';
import { validateAttachments } from './message-attachments.js';
import type { StateManager } from './state-manager.js';
import type { CommandExecutor } from './command-executor.js';
import type { CDPBridge } from './cdp-bridge.js';
import { CursorStorageHistory } from './cursor-storage-history.js';
import { markdownToWebHtml, readPlanFile } from './plan-files.js';
import type { ExtensionFileBridge } from './extension-file-bridge.js';
import { SERVER_INSTANCE, getServerModuleDir } from './server-info.js';
import type { ServerDiagnostics } from '../shared/diagnostics.js';
import { GIT_SNAPSHOT_PUSH_PATH, type GitSnapshotPushPayload } from '../shared/extension-bridge.js';
import {
  WEBAPP_SESSION_COOKIE,
  createWebappSessionStore,
  parseSessionCookie,
  type WebappSessionStore,
} from './webapp-sessions.js';

const POST_COMMAND_REFRESH_DELAYS_MS = [0, 150, 450, 1000, 2000];

interface ViteDevServer {
  middlewares: express.RequestHandler;
  close(): Promise<void>;
}

function resolvePackageRoot(): string {
  const fromEnv = process.env.PACKAGE_ROOT?.trim();
  if (fromEnv && existsSync(join(fromEnv, 'package.json'))) return fromEnv;
  const fromBundle = join(getServerModuleDir(), '..', '..');
  if (existsSync(join(fromBundle, 'package.json'))) return fromBundle;
  return process.cwd();
}

function resolveClientDir(serverDir: string): { clientDir: string; clientBuild: 'vite-dev' | 'static' } {
  const clientSrc = process.env.CLIENT_SRC_DIR?.trim();
  if (clientSrc && existsSync(clientSrc)) {
    return { clientDir: resolve(clientSrc), clientBuild: 'vite-dev' };
  }
  const bundledClientDir = join(serverDir, '..', 'client');
  const isSourceClient = bundledClientDir.replace(/\\/g, '/').endsWith('/src/client');
  return {
    clientDir: bundledClientDir,
    clientBuild: isSourceClient ? 'vite-dev' : 'static',
  };
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const LOGIN_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="theme-color" content="#1a1a2e">
  <title>CursorRemote - Login</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #181818;
      color: rgba(228,228,228,0.92);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100dvh;
    }
    .login-card {
      width: 100%; max-width: 340px; padding: 32px 24px;
      background: #232323; border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.06);
    }
    h1 { font-size: 18px; font-weight: 600; margin-bottom: 6px; text-align: center; }
    .subtitle { font-size: 13px; color: rgba(228,228,228,0.5); margin-bottom: 24px; text-align: center; }
    label { display: block; font-size: 13px; margin-bottom: 6px; color: rgba(228,228,228,0.7); }
    input[type="password"] {
      width: 100%; padding: 10px 12px; font-size: 15px;
      background: #181818; border: 1px solid rgba(255,255,255,0.12); border-radius: 8px;
      color: rgba(228,228,228,0.92); outline: none;
    }
    input[type="password"]:focus { border-color: #3794ff; }
    button {
      width: 100%; padding: 10px; margin-top: 16px; font-size: 15px; font-weight: 500;
      background: #3794ff; color: #fff; border: none; border-radius: 8px; cursor: pointer;
    }
    button:hover { background: #2b7ee0; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .error { color: #e34671; font-size: 13px; margin-top: 12px; text-align: center; display: none; }
  </style>
</head>
<body>
  <form class="login-card" id="form">
    <h1>CursorRemote</h1>
    <p class="subtitle">Enter password to continue</p>
    <label for="pw">Password</label>
    <input type="password" id="pw" name="password" autocomplete="current-password" autofocus required>
    <button type="submit" id="btn">Sign in</button>
    <p class="error" id="err"></p>
  </form>
  <script>
    const form = document.getElementById('form');
    const pw = document.getElementById('pw');
    const btn = document.getElementById('btn');
    const err = document.getElementById('err');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true;
      err.style.display = 'none';
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw.value }),
        });
        const data = await res.json();
        if (res.ok && data.token) {
          localStorage.setItem('cursor-remote-token', data.token);
          window.location.href = '/';
        } else {
          err.textContent = data.error || 'Invalid password';
          err.style.display = 'block';
        }
      } catch {
        err.textContent = 'Network error';
        err.style.display = 'block';
      }
      btn.disabled = false;
    });
  </script>
</body>
</html>`;

export class Relay {
  private config: ServerConfig;
  private app: express.Application;
  private httpServer: ReturnType<typeof createServer>;
  private io: SocketServer;
  private stateManager: StateManager;
  private commandExecutor: CommandExecutor;
  private cdpBridge: CDPBridge;
  private extensionBridge: ExtensionFileBridge;
  private storageHistory: CursorStorageHistory;
  private viteDevServer?: Promise<ViteDevServer>;
  private requestFreshExtraction: () => void;
  private readonly clientBuild: 'vite-dev' | 'static';
  private readonly clientDir: string;

  private sessionStore: WebappSessionStore;
  private loginAttempts = new Map<string, RateLimitEntry>();

  /** Max-Age for session cookie (30 days), aligned with typical “stay signed in” expectation. */
  private static readonly SESSION_COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60;

  private get authEnabled(): boolean {
    return this.config.webappPassword.length > 0;
  }

  constructor(
    config: ServerConfig,
    stateManager: StateManager,
    commandExecutor: CommandExecutor,
    cdpBridge: CDPBridge,
    extensionBridge: ExtensionFileBridge,
    requestFreshExtraction: () => void = () => {}
  ) {
    this.config = config;
    this.stateManager = stateManager;
    this.commandExecutor = commandExecutor;
    this.cdpBridge = cdpBridge;
    this.extensionBridge = extensionBridge;
    this.requestFreshExtraction = requestFreshExtraction;
    this.storageHistory = new CursorStorageHistory(config.cursorStateDbPath);
    this.sessionStore = createWebappSessionStore(config.dataDir);
    const resolvedClient = resolveClientDir(getServerModuleDir());
    this.clientDir = resolvedClient.clientDir;
    this.clientBuild = resolvedClient.clientBuild;
    if (this.clientBuild === 'vite-dev') {
      console.log(`[relay] Serving web client from source via Vite: ${this.clientDir}`);
    }

    this.app = express();
    this.httpServer = createServer(this.app);
    this.io = new SocketServer(this.httpServer, {
      serveClient: false,
      cors: {
        origin: true,
        methods: ['GET', 'POST'],
        credentials: true,
      },
    });

    this.setupRoutes();
    this.setupSocketHandlers();
    this.setupStateForwarding();

    if (this.authEnabled) {
      console.log('[relay] Web app password protection enabled');
    }
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.config.serverPort, this.config.serverHost, () => {
        console.log(
          `[relay] Server listening on http://${this.config.serverHost}:${this.config.serverPort}`
        );
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.io.close();
    if (this.viteDevServer) {
      await (await this.viteDevServer).close();
    }
    return new Promise((resolve) => {
      this.httpServer.close(() => resolve());
    });
  }

  private getClientIp(req: express.Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
    return req.socket.remoteAddress ?? 'unknown';
  }

  private isLocalRequest(req: express.Request): boolean {
    const ip = req.socket.remoteAddress ?? '';
    return ip === '127.0.0.1'
      || ip === '::1'
      || ip === '::ffff:127.0.0.1'
      || ip.endsWith('127.0.0.1');
  }

  private checkRateLimit(ip: string): { allowed: boolean; retryAfter: number } {
    const now = Date.now();
    const entry = this.loginAttempts.get(ip);

    if (!entry || now >= entry.resetAt) {
      this.loginAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
      return { allowed: true, retryAfter: 0 };
    }

    if (entry.count >= 10) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      return { allowed: false, retryAfter };
    }

    entry.count++;
    return { allowed: true, retryAfter: 0 };
  }

  /** First matching credential that exists in the persisted session store. */
  private resolveHttpSession(req: express.Request): string | undefined {
    if (!this.authEnabled) return undefined;
    const authHeader = req.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const t = authHeader.slice(7).trim();
      if (this.sessionStore.has(t)) return t;
    }
    const fromCookie = parseSessionCookie(req.headers.cookie, WEBAPP_SESSION_COOKIE);
    if (fromCookie && this.sessionStore.has(fromCookie)) return fromCookie;
    return undefined;
  }

  private resolveSocketSession(socket: Socket): string | undefined {
    if (!this.authEnabled) return undefined;
    const raw = socket.handshake.auth?.token;
    const bearer = typeof raw === 'string' ? raw.trim() : '';
    if (bearer && this.sessionStore.has(bearer)) return bearer;
    const cookieHeader = socket.handshake.headers.cookie;
    const fromCookie = parseSessionCookie(
      typeof cookieHeader === 'string' ? cookieHeader : undefined,
      WEBAPP_SESSION_COOKIE
    );
    if (fromCookie && this.sessionStore.has(fromCookie)) return fromCookie;
    return undefined;
  }

  private buildDiagnostics(): ServerDiagnostics {
    const state = this.stateManager.getCurrentState();
    const activeWindow = state.windows.find(window => window.id === state.activeWindowId);
    return {
      server: {
        version: SERVER_INSTANCE.version,
        instanceId: SERVER_INSTANCE.instanceId,
        pid: SERVER_INSTANCE.pid,
        port: this.config.serverPort,
        host: this.config.serverHost,
        dataDirName: basename(this.config.dataDir),
        startedAt: SERVER_INSTANCE.startedAt,
        clientBuild: this.clientBuild,
      },
      extensionBridge: this.extensionBridge.getDiagnostics(),
      gitSnapshots: this.stateManager.getGitSnapshotDiagnostics(activeWindow?.title ?? null),
      gitStatus: state.gitStatus,
      connected: state.connected,
      generation: this.stateManager.generation,
      uptime: process.uptime(),
      clients: this.io.engine.clientsCount,
      activeWindowId: state.activeWindowId,
      activeWindowTitle: activeWindow?.title ?? null,
      cdpUrl: this.config.cdpUrl,
    };
  }

  private setupRoutes(): void {
    const clientDir = this.clientDir;
    const isSourceClient = this.clientBuild === 'vite-dev';

    this.app.use(express.json());

    this.app.post(GIT_SNAPSHOT_PUSH_PATH, (req, res) => {
      if (!this.isLocalRequest(req)) {
        res.status(403).json({ error: 'forbidden' });
        return;
      }

      const payload = req.body as GitSnapshotPushPayload;
      if (
        !payload
        || typeof payload.windowKey !== 'string'
        || !payload.windowKey.trim()
        || !payload.gitStatus
        || typeof payload.gitStatus.changedCount !== 'number'
      ) {
        res.status(400).json({ error: 'invalid payload' });
        return;
      }

      const gitStatus = this.stateManager.upsertGitWindowSnapshot({
        ...payload,
        windowKey: payload.windowKey.trim(),
        updatedAt: payload.updatedAt || Date.now(),
        gitStatus: {
          ...payload.gitStatus,
          available: payload.gitStatus.available !== false,
          source: 'vscode.git',
          updatedAt: payload.updatedAt || Date.now(),
          windowKey: payload.windowKey.trim(),
        },
      });
      res.json({ ok: true, gitStatus });
    });

    this.app.get('/login', (_req, res) => {
      if (!this.authEnabled) return res.redirect('/');
      res.type('html').send(LOGIN_PAGE_HTML);
    });

    this.app.post('/api/login', (req, res) => {
      if (!this.authEnabled) return res.json({ token: 'no-auth' });

      const ip = this.getClientIp(req);
      const { allowed, retryAfter } = this.checkRateLimit(ip);
      if (!allowed) {
        console.warn(`[relay] Rate limited login from ${ip}`);
        res.set('Retry-After', String(retryAfter));
        return res.status(429).json({ error: `Too many attempts. Retry in ${retryAfter}s.` });
      }

      const password = req.body?.password;
      if (typeof password !== 'string' || password.length === 0) {
        return res.status(400).json({ error: 'Password required' });
      }

      const expected = Buffer.from(this.config.webappPassword);
      const received = Buffer.from(password);
      if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
        console.warn(`[relay] Failed login attempt from ${ip}`);
        return res.status(401).json({ error: 'Invalid password' });
      }

      const token = randomBytes(32).toString('hex');
      this.sessionStore.add(token);
      console.log(`[relay] Successful login from ${ip}`);
      res.setHeader(
        'Set-Cookie',
        [
          `${WEBAPP_SESSION_COOKIE}=${token}`,
          'HttpOnly',
          'Path=/',
          'SameSite=Lax',
          `Max-Age=${Relay.SESSION_COOKIE_MAX_AGE_SEC}`,
        ].join('; ')
      );
      return res.json({ token });
    });

    this.app.get('/health', (req, res) => {
      const diagnostics = this.buildDiagnostics();
      const sessionOk = !this.authEnabled || this.resolveHttpSession(req) !== undefined;
      res.json({
        ok: true,
        authRequired: this.authEnabled,
        sessionValid: sessionOk,
        connected: diagnostics.connected,
        extractorStatus: this.stateManager.getCurrentState().extractorStatus,
        lastExtractionAt: this.stateManager.getCurrentState().lastExtractionAt,
        consecutiveExtractionFailures: this.stateManager.getCurrentState().consecutiveExtractionFailures,
        lastExtractionError: this.stateManager.getCurrentState().lastExtractionError,
        agentStatus: this.stateManager.getCurrentState().agentStatus,
        clients: diagnostics.clients,
        uptime: diagnostics.uptime,
        windows: this.stateManager.getCurrentState().windows,
        activeWindowId: diagnostics.activeWindowId,
        mode: this.stateManager.getCurrentState().mode?.current ?? null,
        model: this.stateManager.getCurrentState().model?.current ?? null,
        chatTabCount: this.stateManager.getCurrentState().chatTabs?.length ?? 0,
        pendingApprovalCount: this.stateManager.getCurrentState().pendingApprovals?.length ?? 0,
        gitStatus: diagnostics.gitStatus,
        generation: diagnostics.generation,
        server: diagnostics.server,
      });
    });

    this.app.get('/debug/info', (req, res) => {
      if (this.authEnabled && this.resolveHttpSession(req) === undefined) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      res.json(this.buildDiagnostics());
    });

    this.app.get('/debug/state', (req, res) => {
      if (this.authEnabled && this.resolveHttpSession(req) === undefined) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const state = this.stateManager.getCurrentState();
      res.json({
        activeWindowId: state.activeWindowId,
        agentStatus: state.agentStatus,
        agentActivityText: state.agentActivityText,
        agentActivityLive: state.agentActivityLive,
        agentActivitySource: state.agentActivitySource,
        agentStopSelectorPath: state.agentStopSelectorPath,
        agentStopAvailable: state.agentStopAvailable,
        agentStopSource: state.agentStopSource,
        pendingApprovals: state.pendingApprovals,
        gitStatus: state.gitStatus,
        chatTabs: state.chatTabs.map((t) => ({
          isActive: t.isActive,
          title: t.title,
          composerId: t.composerId.substring(0, 16),
        })),
        windows: state.windows.map((w) => ({ id: w.id.substring(0, 8), title: w.title })),
        messageCount: state.messages.length,
        lastMessages: state.messages.slice(-3).map((m) => ({
          type: m.type,
          flatIndex: m.flatIndex,
          ...(m.type === 'tool' || m.type === 'run_command' ? {
            actions: 'actions' in m ? m.actions?.length ?? 0 : 0,
          } : {}),
        })),
        generation: this.stateManager.generation,
      });
    });

    if (isSourceClient) {
      this.app.use(async (req, res, next) => {
        try {
          const vite = await this.getViteDevServer(clientDir);
          vite.middlewares(req, res, next);
        } catch (err) {
          next(err);
        }
      });
    } else {
      const cacheBust = Date.now().toString(36);
      this.app.get('/', (_req, res) => {
        const htmlPath = join(clientDir, 'index.html');
        try {
          let html = readFileSync(htmlPath, 'utf-8');
          html = html.replace(/(src|href)="([^"]+)\.(js|css)"/g, `$1="$2.$3?v=${cacheBust}"`);
          res.setHeader('Cache-Control', 'no-store');
          res.type('html').send(html);
        } catch (err) {
          console.error(`[relay] Failed to serve index.html: ${err}`);
          res.status(500).send('Client files not found');
        }
      });

      this.app.use(express.static(clientDir, {
        etag: true,
        lastModified: true,
        setHeaders: (res) => {
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        },
      }));
    }

    const authMiddleware: express.RequestHandler = (req, res, next) => {
      if (!this.authEnabled) return next();

      if (this.resolveHttpSession(req)) return next();

      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      return res.redirect('/login');
    };

    this.app.use(authMiddleware);
  }

  private getViteDevServer(clientDir: string): Promise<ViteDevServer> {
    this.viteDevServer ??= (async () => {
      const packageRoot = resolvePackageRoot();
      const requireFromPackage = createRequire(join(packageRoot, 'package.json'));
      const { createServer: createViteServer } = requireFromPackage('vite') as {
        createServer: (options: Record<string, unknown>) => Promise<ViteDevServer>;
      };
      const configFile = existsSync(join(packageRoot, 'vite.config.ts'))
        ? join(packageRoot, 'vite.config.ts')
        : undefined;
      return createViteServer({
        root: clientDir,
        configFile,
        server: {
          middlewareMode: true,
          hmr: false,
        },
        appType: 'spa',
      });
    })();
    return this.viteDevServer;
  }

  private setupSocketHandlers(): void {
    if (this.authEnabled) {
      this.io.use((socket, next) => {
        const resolved = this.resolveSocketSession(socket);
        if (resolved) return next();
        const raw = socket.handshake.auth?.token;
        const hint =
          typeof raw === 'string' && raw.length > 0
            ? raw.slice(0, 8) + '...'
            : parseSessionCookie(
                typeof socket.handshake.headers.cookie === 'string'
                  ? socket.handshake.headers.cookie
                  : undefined,
                WEBAPP_SESSION_COOKIE
              )
              ? 'cookie-present'
              : 'empty';
        console.warn(`[relay] Socket.io auth rejected (${socket.id}) — ${hint}`);
        next(new Error('Unauthorized'));
      });
    }

    this.io.on('connection', (socket) => {
      console.log(`[relay] Client connected: ${socket.id}`);

      this.stateManager.hydrateGitStatus();
      socket.emit('state:full', this.stateManager.getCurrentState());

      socket.on('command:send_message', async (payload: CommandPayload) => {
        const text = (payload.text || '').trim();
        const attachments = payload.attachments ?? [];
        if (!payload.commandId || (!text && attachments.length === 0)) {
          socket.emit('command:result', {
            commandId: payload.commandId ?? 'unknown',
            ok: false,
            error: 'Missing commandId, text, or attachments',
          } satisfies CommandResult);
          return;
        }
        const attachmentError = validateAttachments(attachments);
        if (attachmentError) {
          socket.emit('command:result', {
            commandId: payload.commandId,
            ok: false,
            error: attachmentError,
          } satisfies CommandResult);
          return;
        }
        console.log(`[relay] Command: send_message from ${socket.id}`);
        const result = await this.commandExecutor.sendMessage(
          payload.commandId,
          text || undefined,
          attachments
        );
        if (result.ok) {
          this.requestFreshExtractionBurst();
        }
        socket.emit('command:result', result);
      });

      socket.on('command:load_history', async (payload: CommandPayload) => {
        if (!payload.commandId) {
          socket.emit('command:result', {
            commandId: 'unknown',
            ok: false,
            error: 'Missing commandId',
          } satisfies CommandResult);
          return;
        }
        const countBefore = this.stateManager.getCurrentState().messages.length;
        const currentState = this.stateManager.getCurrentState();
        const composerId = payload.composerId || currentState.activeComposerId;
        const times = Math.min(Math.max(payload.times ?? 2, 1), 8);
        console.log(`[relay] Command: load_history (${times}x) from ${socket.id}`);

        if (composerId) {
          try {
            const stored = await this.storageHistory.loadComposerHistory(composerId);
            if (stored && stored.loadedBubbles > 0) {
              const merged = this.stateManager.mergeStoredHistory(stored.messages);
              console.log(
                `[relay] load_history storage: composer=${composerId.slice(0, 8)} ` +
                `headers=${stored.totalHeaders} loaded=${stored.loadedBubbles} added=${merged.addedCount}`
              );
              socket.emit('command:result', {
                commandId: payload.commandId,
                ok: true,
                data: {
                  addedCount: merged.addedCount,
                  totalCount: merged.totalCount,
                  source: 'cursor_storage',
                  loadedBubbles: stored.loadedBubbles,
                  totalHeaders: stored.totalHeaders,
                },
              } satisfies CommandResult);
              return;
            }
          } catch (err) {
            console.warn(
              `[relay] load_history storage fallback: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }

        const genBefore = this.stateManager.generation;

        const scrollResult = await this.commandExecutor.scrollChatUp(payload.commandId, times);
        if (!scrollResult.ok) {
          socket.emit('command:result', scrollResult);
          return;
        }

        await waitForFreshExtraction(this.stateManager, genBefore, 6000);
        const countAfterScroll = this.stateManager.getCurrentState().messages.length;

        // Return Cursor to the live tail with a single scrollTop jump (no wheel burst).
        const bottomGen = this.stateManager.generation;
        const bottomId = `${payload.commandId}-bottom`;
        await this.commandExecutor.scrollChatToBottom(bottomId);
        await waitForFreshExtraction(this.stateManager, bottomGen, 3000);

        const totalCount = this.stateManager.getCurrentState().messages.length;
        const addedCount = Math.max(0, countAfterScroll - countBefore);
        socket.emit('command:result', {
          commandId: payload.commandId,
          ok: true,
          data: { addedCount, totalCount },
        } satisfies CommandResult);
      });

      socket.on('command:approve', async (payload: CommandPayload) => {
        if (!payload.commandId || !payload.selectorPath) {
          socket.emit('command:result', {
            commandId: payload.commandId ?? 'unknown',
            ok: false,
            error: 'Missing commandId or selectorPath',
          } satisfies CommandResult);
          return;
        }
        console.log(`[relay] Command: approve from ${socket.id}`);
        const result = await this.commandExecutor.clickApproval(
          payload.commandId,
          payload.selectorPath
        );
        socket.emit('command:result', result);
      });

      socket.on('command:approve_all', async (payload: CommandPayload) => {
        if (!payload.commandId) {
          socket.emit('command:result', {
            commandId: 'unknown',
            ok: false,
            error: 'Missing commandId',
          } satisfies CommandResult);
          return;
        }
        console.log(`[relay] Command: approve_all from ${socket.id}`);
        const result = await this.commandExecutor.approveAll(payload.commandId);
        socket.emit('command:result', result);
      });

      socket.on('command:reject', async (payload: CommandPayload) => {
        if (!payload.commandId || !payload.selectorPath) {
          socket.emit('command:result', {
            commandId: payload.commandId ?? 'unknown',
            ok: false,
            error: 'Missing commandId or selectorPath',
          } satisfies CommandResult);
          return;
        }
        console.log(`[relay] Command: reject from ${socket.id}`);
        const result = await this.commandExecutor.reject(
          payload.commandId,
          payload.selectorPath
        );
        socket.emit('command:result', result);
      });

      socket.on('command:switch_tab', async (payload: CommandPayload) => {
        if (!payload.commandId || (!payload.tabTitle && !payload.selectorPath && !payload.composerId)) {
          socket.emit('command:result', {
            commandId: payload.commandId ?? 'unknown',
            ok: false,
            error: 'Missing commandId and tab target',
          } satisfies CommandResult);
          return;
        }
        console.log(`[relay] Command: switch_tab to "${payload.tabTitle ?? payload.composerId ?? payload.selectorPath}" from ${socket.id}`);
        const result = await this.commandExecutor.switchTab(
          payload.commandId,
          payload.tabTitle ?? '',
          payload.selectorPath,
          payload.composerId,
          payload.tabSource
        );
        socket.emit('command:result', result);
      });

      socket.on('command:close_tab', async (payload: CommandPayload) => {
        if (!payload.commandId || (!payload.tabTitle && !payload.composerId)) {
          socket.emit('command:result', {
            commandId: payload.commandId ?? 'unknown',
            ok: false,
            error: 'Missing commandId and tab target',
          } satisfies CommandResult);
          return;
        }
        console.log(`[relay] Command: close_tab "${payload.tabTitle ?? payload.composerId}" from ${socket.id}`);
        const result = await this.commandExecutor.closeTab(
          payload.commandId,
          payload.tabTitle ?? '',
          payload.composerId,
          payload.tabSource
        );
        socket.emit('command:result', result);
      });

      socket.on('command:new_chat', async (payload: CommandPayload) => {
        if (!payload.commandId) {
          socket.emit('command:result', {
            commandId: 'unknown',
            ok: false,
            error: 'Missing commandId',
          } satisfies CommandResult);
          return;
        }
        console.log(`[relay] Command: new_chat from ${socket.id}`);
        const result = await this.commandExecutor.newChat(payload.commandId);
        socket.emit('command:result', result);
      });

      socket.on('command:set_mode', async (payload: CommandPayload) => {
        if (!payload.commandId || !payload.modeId) {
          socket.emit('command:result', {
            commandId: payload.commandId ?? 'unknown',
            ok: false,
            error: 'Missing commandId or modeId',
          } satisfies CommandResult);
          return;
        }
        console.log(`[relay] Command: set_mode to ${payload.modeId} from ${socket.id}`);
        const result = await this.commandExecutor.setMode(
          payload.commandId,
          payload.modeId
        );
        socket.emit('command:result', result);
      });

      socket.on('command:set_model', async (payload: CommandPayload) => {
        if (!payload.commandId || !payload.modelId) {
          socket.emit('command:result', {
            commandId: payload.commandId ?? 'unknown',
            ok: false,
            error: 'Missing commandId or modelId',
          } satisfies CommandResult);
          return;
        }
        console.log(`[relay] Command: set_model to ${payload.modelId} from ${socket.id}`);
        const result = await this.commandExecutor.setModel(
          payload.commandId,
          payload.modelId
        );
        socket.emit('command:result', result);
      });

      socket.on('command:get_model_options', async (payload: CommandPayload) => {
        if (!payload.commandId) {
          socket.emit('command:result', {
            commandId: payload.commandId ?? 'unknown',
            ok: false,
            error: 'Missing commandId',
          } satisfies CommandResult);
          return;
        }
        console.log(`[relay] Command: get_model_options from ${socket.id}`);
        const result = await this.commandExecutor.getModelOptions(
          payload.commandId
        );
        socket.emit('command:result', result);
      });

      socket.on('command:get_plan_full', async (payload: CommandPayload) => {
        if (!payload.commandId || !payload.planLabel) {
          socket.emit('command:result', {
            commandId: payload.commandId ?? 'unknown',
            ok: false,
            error: 'Missing commandId or planLabel',
          } satisfies CommandResult);
          return;
        }
        console.log(`[relay] Command: get_plan_full for ${payload.planLabel} from ${socket.id}`);
        const planFile = readPlanFile(payload.planLabel);
        if (!planFile) {
          socket.emit('command:result', {
            commandId: payload.commandId,
            ok: false,
            error: 'Plan file not found',
          } satisfies CommandResult);
          return;
        }
        socket.emit('command:result', {
          commandId: payload.commandId,
          ok: true,
          data: {
            todos: planFile.todos,
            body: planFile.body,
            bodyHtml: markdownToWebHtml(planFile.body),
          },
        } satisfies CommandResult);
      });

      socket.on('command:get_plan_model_options', async (payload: CommandPayload) => {
        if (!payload.commandId || !payload.selectorPath) {
          socket.emit('command:result', {
            commandId: payload.commandId ?? 'unknown',
            ok: false,
            error: 'Missing commandId or selectorPath',
          } satisfies CommandResult);
          return;
        }
        console.log(`[relay] Command: get_plan_model_options from ${socket.id}`);
        const result = await this.commandExecutor.getPlanModelOptions(
          payload.commandId,
          payload.selectorPath
        );
        socket.emit('command:result', result);
      });

      socket.on('command:set_plan_model', async (payload: CommandPayload) => {
        if (!payload.commandId || !payload.selectorPath || !payload.planModelId) {
          socket.emit('command:result', {
            commandId: payload.commandId ?? 'unknown',
            ok: false,
            error: 'Missing commandId, selectorPath, or planModelId',
          } satisfies CommandResult);
          return;
        }
        console.log(`[relay] Command: set_plan_model to ${payload.planModelId} from ${socket.id}`);
        const result = await this.commandExecutor.setPlanModel(
          payload.commandId,
          payload.selectorPath,
          payload.planModelId
        );
        socket.emit('command:result', result);
      });

      socket.on('command:click_action', async (payload: CommandPayload) => {
        if (!payload.commandId || !payload.selectorPath) {
          socket.emit('command:result', {
            commandId: payload.commandId ?? 'unknown',
            ok: false,
            error: 'Missing commandId or selectorPath',
          } satisfies CommandResult);
          return;
        }
        console.log(`[relay] Command: click_action from ${socket.id}`);
        const result = await this.commandExecutor.clickAction(
          payload.commandId,
          payload.selectorPath
        );
        if (result.ok) {
          this.requestFreshExtractionBurst();
        }
        socket.emit('command:result', result);
      });

      socket.on('command:stop_agent', async (payload: CommandPayload) => {
        if (!payload.commandId) {
          socket.emit('command:result', {
            commandId: 'unknown',
            ok: false,
            error: 'Missing commandId',
          } satisfies CommandResult);
          return;
        }
        const state = this.stateManager.getCurrentState();
        const selectorPath = state.agentStopSelectorPath
          || state.backgroundTasks.find(task => task.stopSelectorPath)?.stopSelectorPath
          || '';
        if (!selectorPath) {
          socket.emit('command:result', {
            commandId: payload.commandId,
            ok: false,
            error: 'Stop button not available',
          } satisfies CommandResult);
          return;
        }
        console.log(`[relay] Command: stop_agent from ${socket.id}`);
        const result = await this.commandExecutor.clickAction(payload.commandId, selectorPath);
        if (result.ok) {
          this.requestFreshExtractionBurst();
        }
        socket.emit('command:result', result);
      });

      socket.on('command:open_source_control', async (payload: CommandPayload) => {
        if (!payload.commandId) {
          socket.emit('command:result', {
            commandId: 'unknown',
            ok: false,
            error: 'Missing commandId',
          } satisfies CommandResult);
          return;
        }
        console.log(`[relay] Command: open_source_control from ${socket.id}`);
        try {
          await this.extensionBridge.requestOpenSourceControl(payload.commandId);
          socket.emit('command:result', { commandId: payload.commandId, ok: true } satisfies CommandResult);
        } catch (err) {
          socket.emit('command:result', {
            commandId: payload.commandId,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          } satisfies CommandResult);
        }
      });

      socket.on('command:kill_server', async (payload: CommandPayload) => {
        if (!payload.commandId) {
          socket.emit('command:result', {
            commandId: 'unknown',
            ok: false,
            error: 'Missing commandId',
          } satisfies CommandResult);
          return;
        }
        console.log(`[relay] Command: kill_server from ${socket.id}`);
        socket.emit('command:result', { commandId: payload.commandId, ok: true } satisfies CommandResult);
        setTimeout(() => {
          void this.stop().finally(() => process.exit(0));
        }, 50);
      });

      socket.on('command:switch_window', async (payload: CommandPayload) => {
        if (!payload.commandId || !payload.windowId) {
          socket.emit('command:result', {
            commandId: payload.commandId ?? 'unknown',
            ok: false,
            error: 'Missing commandId or windowId',
          } satisfies CommandResult);
          return;
        }
        console.log(`[relay] Command: switch_window to ${payload.windowId} from ${socket.id}`);
        try {
          await this.cdpBridge.switchWindow(payload.windowId);
          socket.emit('command:result', { commandId: payload.commandId, ok: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          socket.emit('command:result', { commandId: payload.commandId, ok: false, error: msg });
        }
      });

      socket.on('disconnect', (reason) => {
        console.log(`[relay] Client disconnected: ${socket.id} (${reason})`);
      });
    });
  }

  private setupStateForwarding(): void {
    this.stateManager.on('state:patch', (patch: Partial<CursorState>) => {
      this.io.emit('state:patch', patch);
    });

    this.stateManager.on('connection:changed', (connected: boolean) => {
      this.io.emit('connection:status', { connected });
    });
  }

  private requestFreshExtractionBurst(): void {
    for (const delayMs of POST_COMMAND_REFRESH_DELAYS_MS) {
      setTimeout(() => this.requestFreshExtraction(), delayMs);
    }
  }
}
