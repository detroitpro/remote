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
  const windowFilter = args.find((_, i, a) => a[i - 1] === '--window') ?? 'cursor-ide-remote';

  const config = loadConfig();
  const resp = await fetch(`${config.cdpUrl}/json`, { signal: AbortSignal.timeout(5000) });
  const targets = await resp.json() as CDPTarget[];
  const pages = targets.filter((t) => t.type === 'page' && t.url.includes('workbench'));
  const target =
    pages.find((p) => p.title.toLowerCase().includes(windowFilter.toLowerCase())) ?? pages[0];
  if (!target?.webSocketDebuggerUrl) {
    console.error('[probe] No target');
    process.exit(1);
  }
  console.log(`[probe] Probing "${target.title}"`);

  const { CdpClient } = await import('../src/server/cdp-client.js');
  const client = new CdpClient();
  await client.connect(target.webSocketDebuggerUrl);

  const result = await client.evaluate(`(() => {
    const section = document.querySelector('#composer-toolbar-section');
    if (!section) return { error: 'no #composer-toolbar-section' };
    const items = section.querySelectorAll('.composer-toolbar-queue-item');
    const out = [];
    for (const item of items) {
      const btns = item.querySelectorAll('button, [role="button"]');
      const buttons = [];
      for (const b of btns) {
        buttons.push({
          tag: b.tagName,
          cls: String(b.className || '').slice(0, 160),
          aria: b.getAttribute('aria-label'),
          title: b.getAttribute('title'),
          text: (b.textContent || '').trim().slice(0, 80),
        });
      }
      out.push({
        id: item.getAttribute('data-queue-item-id'),
        query: item.getAttribute('data-queue-item-query'),
        cls: String(item.className || '').slice(0, 160),
        buttons,
        inner: item.innerHTML.slice(0, 2500),
        actionHtml: (item.querySelector('.composer-toolbar-queue-item-actions') || {}).innerHTML
          ? item.querySelector('.composer-toolbar-queue-item-actions').innerHTML.slice(0, 1500)
          : null,
      });
    }
    const labelEl = section.querySelector('.opacity-80');
    return {
      queueLabel: labelEl ? (labelEl.textContent || '').trim() : '',
      count: items.length,
      items: out,
    };
  })()`);

  console.log(JSON.stringify(result, null, 2));
  client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
