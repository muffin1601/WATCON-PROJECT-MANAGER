import { MAX_DOCUMENT_UPLOAD_BYTES, formatUploadLimit } from "../../modules/documents/uploadLimits";

export function pickUploadFile(
  file: File | null | undefined,
  onFile: (file: File) => void,
  onError: (message: string) => void,
  maxSizeBytes = MAX_DOCUMENT_UPLOAD_BYTES
) {
  if (!file) return;
  if (file.size > maxSizeBytes) {
    onError(`File is larger than ${formatUploadLimit(maxSizeBytes)}.`);
    return;
  }
  onFile(file);
}
