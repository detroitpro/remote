/** Stable Cursor composer / transcript identifier. */
export const COMPOSER_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface InternalTranscriptLink {
  composerId: string;
  href: string;
}

/** True when the href should open in the browser (http, https, mailto). */
export function isExternalHref(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed) return false;
  return /^(https?:|mailto:)/i.test(trimmed);
}

/**
 * Detect Cursor-internal transcript/history links emitted in assistant HTML.
 * Returns null for external URLs and unrecognized relative paths.
 */
export function parseInternalTranscriptLink(href: string): InternalTranscriptLink | null {
  const trimmed = href.trim();
  if (!trimmed || isExternalHref(trimmed)) return null;

  if (COMPOSER_UUID_RE.test(trimmed)) {
    return { composerId: trimmed, href: trimmed };
  }

  try {
    const url = new URL(trimmed, 'http://cursor.local/');
    const path = url.pathname;

    const transcriptMatch = path.match(
      /\/agent-transcripts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i,
    );
    if (transcriptMatch) {
      return { composerId: transcriptMatch[1], href: trimmed };
    }

    const pathUuid = path.match(
      /^\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    );
    if (pathUuid) {
      return { composerId: pathUuid[1], href: trimmed };
    }

    const parts = path.split('/').filter(Boolean);
    const last = parts[parts.length - 1]?.replace(/\.jsonl$/i, '') ?? '';
    if (COMPOSER_UUID_RE.test(last)) {
      return { composerId: last, href: trimmed };
    }
  } catch {
    // Unrecognized relative href.
  }

  return null;
}

/** True when an anchor href refers to the given transcript/composer UUID. */
export function hrefMatchesTranscriptTarget(href: string, transcriptId: string): boolean {
  const trimmedHref = href.trim();
  const trimmedId = transcriptId.trim();
  if (!trimmedHref || !trimmedId) return false;
  if (trimmedHref === trimmedId) return true;
  if (trimmedHref.includes(trimmedId)) return true;

  const parsed = parseInternalTranscriptLink(trimmedHref);
  return parsed?.composerId === trimmedId;
}
