/**
 * If `agentActivityText` stays identical across polls for this long, it is cleared
 * for relay state (web UI). Matches TelegramTransport ephemeral activity cleanup.
 */
export const AGENT_ACTIVITY_STALE_MS = 30_000;

/** Keep last known background tasks briefly when DOM chrome hides them during active agent work. */
export const BACKGROUND_TASKS_STALE_MS = 45_000;
