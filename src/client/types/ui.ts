export type BooleanStateSetter = (value: boolean | ((prev: boolean) => boolean)) => void;

export interface PendingAttachment {
  id: string;
  mimeType: string;
  name: string;
  data: string;
  previewUrl: string;
}

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;
