"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Card, CardBody, CardHeader } from "../Card/Card";
import { Button } from "../Button/Button";
import { AttachmentRow } from "../FileDrop/AttachmentRow";
import { FileDrop } from "../FileDrop/FileDrop";
import { Spinner } from "../Status/Status";
import { ConfirmModal } from "../Modal/ConfirmModal";
import { useToast } from "../Toast/ToastProvider";
import { DuplicateUploadError, useUploadDocument } from "../../hooks/useUploadDocument";
import { apiFetch } from "../../lib/apiClient";
import type { DocumentKind } from "../../modules/documents/schema";
import type { ProjectViewModel } from "../../modules/projects/viewModel";

const ACCEPT = "application/pdf,image/*,.docx,.xlsx,.zip";
const EXTRACTABLE_MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);

// Ported from tabDocs(p, el) — order copy, approval proof, and read-only
// listings of challan/amendment attachments (uploaded from their own tabs).
// This is a per-entity attachment model, not a categorized document
// library (that's Phase 6c's document library UI) — matches the prototype
// exactly for now. "Extract text" indexes the document for search only —
// it never interprets content into fields (Document-Centric workflow, see
// PLAN.md Phase 6). Duplicate uploads (same content, same project) are
// caught and confirmed before proceeding (Part 18).
export function DocumentsTab({ project }: { project: ProjectViewModel }) {
  const router = useRouter();
  const toast = useToast();
  const upload = useUploadDocument();
  const [pendingDuplicate, setPendingDuplicate] = useState<{ kind: DocumentKind; file: File } | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/documents/${id}`, { method: "DELETE" }),
    onSuccess: () => router.refresh(),
    onError: () => toast("Failed to delete document"),
  });

  const extractMutation = useMutation({
    mutationFn: (documentId: string) =>
      apiFetch<{ result: { pageCount: number; pagesWithText: number } }>(`/api/documents/${documentId}/extract-text`, {
        method: "POST",
      }),
    onSuccess: (data) => {
      router.refresh();
      toast(
        data.result.pagesWithText > 0
          ? `Indexed ${data.result.pagesWithText} of ${data.result.pageCount} page(s) for search`
          : "No text found on this document (likely a scanned page with no text layer)"
      );
    },
    onError: (err) => toast(err instanceof Error ? err.message : "Text extraction failed"),
  });

  const orderCopy = project.documents.find((d) => d.kind === "ORDER_COPY");
  const approvalProofs = project.documents.filter((d) => d.kind === "APPROVAL_PROOF");
  const challanAttachments = project.challans.flatMap((c) => c.attachments.map((a) => ({ ...a, label: c.no })));
  const amendmentAttachments = project.amendments.flatMap((a) => a.attachments.map((x) => ({ ...x, label: a.description })));

  const doUpload = (kind: DocumentKind, file: File, allowDuplicate = false) => {
    upload.mutate(
      { file, kind, projectId: project.id, allowDuplicate },
      {
        onSuccess: () => {
          router.refresh();
          setPendingDuplicate(null);
        },
        onError: (err) => {
          if (err instanceof DuplicateUploadError) {
            setPendingDuplicate({ kind, file });
            return;
          }
          toast(err instanceof Error ? err.message : "Upload failed");
        },
      }
    );
  };

  const remove = (id: string) => deleteMutation.mutate(id);

  return (
    <Card>
      <CardHeader>
        <h3>Project documents</h3>
      </CardHeader>
      <CardBody>
        <h4 style={{ fontSize: 13, marginBottom: 8 }}>Order copy (PO / BOQ / approved quotation)</h4>
        {orderCopy ? (
          <>
            <AttachmentRow
              name={orderCopy.fileName}
              addedDate={orderCopy.uploadedAt}
              onView={() => window.open(orderCopy.url, "_blank")}
              onRemove={() => remove(orderCopy.id)}
            />
            {EXTRACTABLE_MIME_TYPES.has(orderCopy.mimeType) && (
              <div style={{ marginBottom: 10 }}>
                <Button size="sm" onClick={() => extractMutation.mutate(orderCopy.id)} disabled={extractMutation.isPending}>
                  {extractMutation.isPending ? <Spinner /> : null}
                  Extract text (for search)
                </Button>
              </div>
            )}
          </>
        ) : (
          <FileDrop accept={ACCEPT} onFile={(f) => doUpload("ORDER_COPY", f)}>
            Drop the PO / BOQ / quotation here, or click to choose a file
          </FileDrop>
        )}

        <h4 style={{ fontSize: 13, margin: "18px 0 8px" }}>
          Approval proof ({project.approvalMode === "QUOTE_VERBAL" ? "Verbal approval" : "attach a copy"})
        </h4>
        {project.approvalMode === "QUOTE_VERBAL" ? (
          <p className="note" style={{ fontSize: 12.5, color: "var(--muted)" }}>
            {project.approvalBasisNote || "Verbal approval — no attachment."}
          </p>
        ) : (
          <>
            {approvalProofs.map((d) => (
              <AttachmentRow
                key={d.id}
                name={d.fileName}
                addedDate={d.uploadedAt}
                onView={() => window.open(d.url, "_blank")}
                onRemove={() => remove(d.id)}
              />
            ))}
            <FileDrop accept={ACCEPT} onFile={(f) => doUpload("APPROVAL_PROOF", f)}>
              Drop approval copy (screenshot / PDF) here, or click to choose a file
            </FileDrop>
          </>
        )}

        <h4 style={{ fontSize: 13, margin: "18px 0 8px" }}>Challan copies</h4>
        {challanAttachments.length === 0 ? (
          <p className="note" style={{ fontSize: 12.5, color: "var(--muted)" }}>
            No challan copies attached yet.
          </p>
        ) : (
          challanAttachments.map((a) => (
            <AttachmentRow
              key={a.id}
              name={`${a.label} — ${a.fileName}`}
              addedDate={a.uploadedAt}
              onView={() => window.open(a.url, "_blank")}
            />
          ))
        )}

        <h4 style={{ fontSize: 13, margin: "18px 0 8px" }}>Amendment approvals</h4>
        {amendmentAttachments.length === 0 ? (
          <p className="note" style={{ fontSize: 12.5, color: "var(--muted)" }}>
            No amendment approvals attached.
          </p>
        ) : (
          amendmentAttachments.map((a) => (
            <AttachmentRow
              key={a.id}
              name={`${a.label} — ${a.fileName}`}
              addedDate={a.uploadedAt}
              onView={() => window.open(a.url, "_blank")}
            />
          ))
        )}
      </CardBody>

      {pendingDuplicate && (
        <ConfirmModal
          message={`"${pendingDuplicate.file.name}" appears to already be attached to this project (identical content). Upload it again anyway?`}
          onCancel={() => setPendingDuplicate(null)}
          onConfirm={() => doUpload(pendingDuplicate.kind, pendingDuplicate.file, true)}
        />
      )}
    </Card>
  );
}
