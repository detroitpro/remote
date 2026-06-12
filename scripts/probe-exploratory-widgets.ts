import 'dotenv/config';
import { loadConfig } from '../src/server/config.js';

interface CDPTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

async function main() {
  const args = process.argv.slice(2);
  const windowFilter = args.find((_, i, a) => a[i - 1] === '--window') ?? '';

  const config = loadConfig();
  const resp = await fetch(`${config.cdpUrl}/json`);
  const targets = await resp.json() as CDPTarget[];
  const pages = targets.filter(t => t.type === 'page' && t.url.includes('workbench'));

  let target = pages[0];
  if (windowFilter) {
    const match = pages.find(p => p.title.toLowerCase().includes(windowFilter.toLowerCase()));
    if (match) target = match;
  }
  if (!target?.webSocketDebuggerUrl) {
    console.error('[probe-exploratory] No workbench target found');
    process.exit(1);
  }
  console.log(`[probe-exploratory] Probing "${target.title}"`);

  const { CdpClient } = await import('../src/server/cdp-client.js');
  const client = new CdpClient();
  await client.connect(target.webSocketDebuggerUrl);

  const result = await client.callFunction(() => {
    const dump = (el: Element) => {
      const attrs: Record<string, string> = {};
      for (const a of Array.from(el.attributes)) {
        if (a.name.startsWith('data-') || a.name.startsWith('aria-') || a.name === 'role' || a.name === 'class') {
          attrs[a.name] = a.value.substring(0, 120);
        }
      }
      return {
        tag: el.tagName,
        text: (el.textContent || '').trim().substring(0, 120),
        attrs,
      };
    };

    const stickyTitleSelectors = [
      '.composer-sticky-title',
      '.agent-transcript-sticky-title',
      '[class*="sticky-title"]',
      '[class*="StickyTitle"]',
    ];
    const cloudWidgetSelectors = [
      '[class*="cloud-widget"]',
      '[class*="CloudWidget"]',
      '[data-cloud-widget]',
    ];
    const subagentTraySelectors = [
      '[class*="subagent-tray"]',
      '[class*="SubagentTray"]',
      '[class*="async-subagent"]',
      '[data-subagent-tray]',
    ];

    const pickFirst = (selectors: string[]) => {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return dump(el);
      }
      return null;
    };

    const pickAll = (selectors: string[], limit = 8) => {
      const out: ReturnType<typeof dump>[] = [];
      for (const sel of selectors) {
        for (const el of Array.from(document.querySelectorAll(sel)).slice(0, limit)) {
          out.push(dump(el));
        }
        if (out.length) break;
      }
      return out;
    };

    return {
      stickyTitle: pickFirst(stickyTitleSelectors),
      cloudWidgets: pickAll(cloudWidgetSelectors),
      subagentTrays: pickAll(subagentTraySelectors),
      hint: 'Update dom-extractor exploratoryUi heuristics once stable selectors are confirmed here.',
    };
  });

  console.log(JSON.stringify(result, null, 2));
  await client.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
