export const MAX_DOCUMENT_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_AI_UPLOAD_BYTES = 20 * 1024 * 1024;

export function formatUploadLimit(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}
