import 'dotenv/config';
import { loadConfig } from '../src/server/config.js';

interface CDPTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

// Dumps questionnaire toolbar option elements (classes, aria-*, data-*)
// so we can confirm isSelected detection in dom-extractor.ts.
//
// Usage: npx tsx scripts/probe-questionnaire.ts [--window <substring>]
// Requires an active agent questionnaire in Cursor (.composer-questionnaire-toolbar).

async function main() {
  const args = process.argv.slice(2);
  const windowFilter = args.find((_, i, a) => a[i - 1] === '--window') ?? '';

  const config = loadConfig();
  const resp = await fetch(`${config.cdpUrl}/json`);
  const targets = await resp.json() as CDPTarget[];
  const pages = targets.filter((t) => t.type === 'page' && t.url.includes('workbench'));
  if (pages.length === 0) {
    console.error('[probe-questionnaire] No workbench page targets found at', config.cdpUrl);
    process.exit(2);
  }
  let target = pages[0];
  if (windowFilter) {
    const m = pages.find((p) => p.title.toLowerCase().includes(windowFilter.toLowerCase()));
    if (m) target = m;
  }
  console.log(`[probe-questionnaire] Probing "${target.title}"`);

  const { CdpClient } = await import('../src/server/cdp-client.js');
  const client = new CdpClient();
  await client.connect(target.webSocketDebuggerUrl!);

  const report = await client.evaluate(`
    (() => {
      const toolbar = document.querySelector('.composer-questionnaire-toolbar');
      if (!toolbar) return { found: false };

      const stepperLabel = (toolbar.querySelector('.composer-questionnaire-toolbar-stepper-label')?.textContent || '').trim();
      const questionEls = Array.from(toolbar.querySelectorAll('.composer-questionnaire-toolbar-question'));

      const questions = questionEls.map((qEl, qi) => {
        const num = (qEl.querySelector('.composer-questionnaire-toolbar-question-number')?.textContent || '').trim();
        const text = (qEl.querySelector('.markdown-root')?.textContent || '').trim().slice(0, 120);
        const isActive = qEl.classList.contains('composer-questionnaire-toolbar-question-active');
        const optionEls = Array.from(qEl.querySelectorAll('.composer-questionnaire-toolbar-option'));

        const options = optionEls.map((optEl) => {
          const letter = (optEl.querySelector('.composer-questionnaire-toolbar-option-letter')?.textContent || '').trim();
          const label = (optEl.querySelector('.composer-questionnaire-toolbar-option-label')?.textContent || '').trim().slice(0, 80);
          const cls = optEl.getAttribute('class') || '';
          const attrs = {};
          for (const attr of optEl.attributes) {
            if (attr.name.startsWith('aria-') || attr.name.startsWith('data-')) {
              attrs[attr.name] = attr.value;
            }
          }
          return {
            letter,
            label: label || (optEl.classList.contains('composer-questionnaire-toolbar-option-freeform') ? 'Other' : ''),
            class: cls,
            attrs,
            letterClass: (optEl.querySelector('.composer-questionnaire-toolbar-option-letter')?.getAttribute('class')) || '',
            labelClass: (optEl.querySelector('.composer-questionnaire-toolbar-option-label')?.getAttribute('class')) || '',
            isUnselectedWithSelections: optEl.classList.contains('composer-questionnaire-toolbar-option-unselected-with-selections'),
            inferredSelected:
              !!optEl.querySelector('.composer-questionnaire-toolbar-option-letter')?.classList.contains('composer-questionnaire-toolbar-option-letter-selected')
              || !!optEl.querySelector('.composer-questionnaire-toolbar-option-label-selected')
              || optEl.classList.contains('composer-questionnaire-toolbar-option-selected')
              || optEl.getAttribute('aria-pressed') === 'true'
              || optEl.getAttribute('aria-selected') === 'true',
          };
        });

        return { index: qi, number: num, text, isActive, options };
      });

      const skipBtn = toolbar.querySelector('.composer-skip-button');
      const contBtn = toolbar.querySelector('.composer-run-button');

      return {
        found: true,
        stepperLabel,
        questionCount: questions.length,
        questions,
        actions: {
          skip: skipBtn ? {
            class: skipBtn.getAttribute('class'),
            text: (skipBtn.textContent || '').trim(),
            stableSelector: '.composer-questionnaire-toolbar .composer-skip-button',
          } : null,
          continue: contBtn ? {
            class: contBtn.getAttribute('class'),
            text: (contBtn.textContent || '').trim(),
            disabled: contBtn.getAttribute('data-disabled') === 'true',
            clickReady: contBtn.getAttribute('data-click-ready') === 'true',
            stableSelector: '.composer-questionnaire-toolbar .composer-questionnaire-toolbar-actions .composer-run-button:not([data-disabled="true"])',
          } : null,
        },
      };
    })()
  `);

  console.log('\n--- Questionnaire toolbar ---');
  console.log(JSON.stringify(report, null, 2));

  if (!(report as { found?: boolean }).found) {
    console.error('\n[probe-questionnaire] No .composer-questionnaire-toolbar found. Open an agent questionnaire first.');
    await client.disconnect();
    process.exit(3);
  }

  await client.disconnect();
  console.log('\n[probe-questionnaire] done. Check hasSelectedClass vs clsIncludesSelected per option.');
}

main().catch((err) => {
  console.error('[probe-questionnaire]', err);
  process.exit(1);
});
