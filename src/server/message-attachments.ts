import { randomUUID } from 'crypto';
import { unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { CdpClient } from './cdp-client.js';
import type { MessageAttachment } from './types.js';

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export const ALLOWED_ATTACHMENT_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
]);

export function validateAttachment(
  attachment: MessageAttachment,
  index = 0
): string | null {
  const mime = (attachment.mimeType || '').trim().toLowerCase();
  if (!mime || !ALLOWED_ATTACHMENT_MIMES.has(mime)) {
    return `Attachment ${index + 1}: unsupported type (${mime || 'missing'})`;
  }
  if (!attachment.data || typeof attachment.data !== 'string') {
    return `Attachment ${index + 1}: missing data`;
  }
  let bytes = 0;
  try {
    bytes = Buffer.byteLength(attachment.data, 'base64');
  } catch {
    return `Attachment ${index + 1}: invalid base64`;
  }
  if (bytes <= 0) {
    return `Attachment ${index + 1}: empty file`;
  }
  if (bytes > MAX_ATTACHMENT_BYTES) {
    return `Attachment ${index + 1}: too large (max ${MAX_ATTACHMENT_BYTES} bytes)`;
  }
  return null;
}

export function validateAttachments(attachments: MessageAttachment[] | undefined): string | null {
  if (!attachments || attachments.length === 0) return null;
  if (attachments.length > 5) return 'Too many attachments (max 5)';
  for (let i = 0; i < attachments.length; i++) {
    const err = validateAttachment(attachments[i], i);
    if (err) return err;
  }
  return null;
}

function mimeToExt(mime: string): string {
  switch (mime) {
    case 'image/png': return 'png';
    case 'image/jpeg':
    case 'image/jpg': return 'jpg';
    case 'image/gif': return 'gif';
    case 'image/webp': return 'webp';
    default: return 'bin';
  }
}

export async function attachFilesToComposer(
  client: CdpClient,
  selectors: string[],
  attachments: MessageAttachment[]
): Promise<void> {
  await client.send('DOM.enable');

  for (const attachment of attachments) {
    const mime = attachment.mimeType.trim().toLowerCase();
    const buf = Buffer.from(attachment.data, 'base64');
    const ext = mimeToExt(mime);
    const tmpPath = join(tmpdir(), `cursor-remote-${randomUUID()}.${ext}`);
    writeFileSync(tmpPath, buf);

    try {
      const doc = await client.send('DOM.getDocument') as { root: { nodeId: number } };
      let nodeId: number | undefined;
      for (const sel of selectors) {
        const q = await client.send('DOM.querySelector', {
          nodeId: doc.root.nodeId,
          selector: sel,
        }) as { nodeId?: number };
        if (q.nodeId) {
          nodeId = q.nodeId;
          break;
        }
      }
      if (!nodeId) {
        throw new Error('Composer file input not found');
      }

      await client.send('DOM.setFileInputFiles', { nodeId, files: [tmpPath] });

      const changed = await client.evaluate(`
        (() => {
          const strategies = ${JSON.stringify(selectors)};
          let fi = null;
          for (const sel of strategies) {
            try {
              fi = document.querySelector(sel);
              if (fi) break;
            } catch {}
          }
          if (!fi) return { ok: false, error: 'file input missing after setFileInputFiles' };
          fi.dispatchEvent(new Event('change', { bubbles: true }));
          fi.dispatchEvent(new Event('input', { bubbles: true }));
          return { ok: true };
        })()
      `) as { ok: boolean; error?: string } | null;

      if (!changed?.ok) {
        throw new Error(changed?.error ?? 'Failed to dispatch file input change');
      }
    } finally {
      try {
        unlinkSync(tmpPath);
      } catch {
        // best-effort cleanup
      }
    }
  }
}
