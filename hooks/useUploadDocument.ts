"use client";

import { useMutation } from "@tanstack/react-query";
import type { DocumentKind } from "../modules/documents/schema";

export interface UploadDocumentArgs {
  file: File;
  kind: DocumentKind;
  projectId?: string;
  challanId?: string;
  paymentId?: string;
  amendmentId?: string;
  purchaseOrderId?: string;
  allowDuplicate?: boolean; // Part 18 — bypasses the same-project checksum duplicate check
  replaceDocumentId?: string; // Part 13 — uploads as the next version of an existing document
}

export class DuplicateUploadError extends Error {
  existingDocumentId: string;
  constructor(message: string, existingDocumentId: string) {
    super(message);
    this.existingDocumentId = existingDocumentId;
  }
}

// Shared multipart upload mutation used by Documents tab, the payment proof
// field, the amendment approval-copy field, and the "Attach Zoho challan"
// challan-copy field.
export function useUploadDocument() {
  return useMutation({
    mutationFn: async (input: UploadDocumentArgs) => {
      const fd = new FormData();
      fd.append("file", input.file);
      fd.append("kind", input.kind);
      if (input.projectId) fd.append("projectId", input.projectId);
      if (input.challanId) fd.append("challanId", input.challanId);
      if (input.paymentId) fd.append("paymentId", input.paymentId);
      if (input.amendmentId) fd.append("amendmentId", input.amendmentId);
      if (input.purchaseOrderId) fd.append("purchaseOrderId", input.purchaseOrderId);
      if (input.allowDuplicate) fd.append("allowDuplicate", "true");
      if (input.replaceDocumentId) fd.append("replaceDocumentId", input.replaceDocumentId);

      const res = await fetch("/api/documents", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.existingDocumentId) {
        throw new DuplicateUploadError(data.error || "Duplicate document", data.existingDocumentId);
      }
      if (!res.ok) throw new Error(data.error || "Upload failed");
      return data.document as { id: string };
    },
  });
}
