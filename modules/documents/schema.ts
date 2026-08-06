export const DOCUMENT_KINDS = [
  "ORDER_COPY",
  "APPROVAL_PROOF",
  "CHALLAN_COPY",
  "AMENDMENT_APPROVAL",
  "PAYMENT_PROOF",
  "TRANSPORT_BILL",
  // Document-library categories (must stay in sync with prisma DocumentKind)
  "PURCHASE_ORDER",
  "BOQ",
  "DRAWING",
  "INVOICE",
  "VENDOR_DOCUMENT",
  "RUNNING_BILL_COPY",
  "PHOTO",
  "OTHER",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

// Matches the file types the prototype's attachment inputs accept
// (`accept="application/pdf,image/*"`) plus the office formats explicitly
// required by this phase's spec (DOCX/XLSX/ZIP).
export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/zip",
  "application/x-zip-compressed",
]);

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB, matches the OCR upload limit noted in the prototype

export function assertValidUpload(file: { type: string; size: number }) {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new Error("Unsupported file type. Allowed: PDF, DOCX, XLSX, PNG, JPG, JPEG, ZIP.");
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error("File is larger than 25 MB.");
  }
}
