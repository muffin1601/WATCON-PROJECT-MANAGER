export const MAX_DOCUMENT_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_AI_UPLOAD_BYTES = MAX_DOCUMENT_UPLOAD_BYTES;

export function formatUploadLimit(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}
