const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function sanitizeHtml(html: string): string {
  if (!html) return '';
  if (typeof document === 'undefined') return html;

  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('script, style, iframe, object, embed').forEach(node => node.remove());

  tmp.querySelectorAll<HTMLElement>('*').forEach(node => {
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) {
        node.removeAttribute(attr.name);
        continue;
      }

      if (name === 'href' || name === 'src') {
        try {
          const url = new URL(attr.value, window.location.href);
          if (!ALLOWED_PROTOCOLS.has(url.protocol) && !(name === 'src' && url.protocol === 'data:')) {
            node.removeAttribute(attr.name);
          }
        } catch {
          node.removeAttribute(attr.name);
        }
      }
    }
  });

  return tmp.innerHTML;
}

export function plainTextToHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replace(/\n/g, '<br>');
}
