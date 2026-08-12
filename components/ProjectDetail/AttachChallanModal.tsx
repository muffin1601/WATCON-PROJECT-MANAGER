"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Modal } from "../Modal/Modal";
import { Button } from "../Button/Button";
import { FormField, FormRow } from "../Form/FormField";
import { TextInput } from "../Form/Inputs";
import { TableWrap, Table, Th, Td } from "../Table/Table";
import { apiFetch } from "../../lib/apiClient";
import { useToast } from "../Toast/ToastProvider";
import { useUploadDocument } from "../../hooks/useUploadDocument";
import { useExtractionJob } from "../../hooks/useExtractionJob";
import { ExtractionProgress } from "../ProgressBar/ExtractionProgress";
import { AiBadge } from "../Status/Status";
import { Chip } from "../Chip/Chip";
import { todayIso } from "../../lib/format";
import { MAX_AI_UPLOAD_BYTES, formatUploadLimit } from "../../modules/documents/uploadLimits";
import { pickUploadFile } from "../FileDrop/pickUploadFile";
import type { ProjectViewModel } from "../../modules/projects/viewModel";

/** Shape of the challan job's `result`, as written by runChallanExtraction(). */
interface ChallanExtractionResult {
  no: string;
  date: string;
  vehicle: string;
  totalValue: number;
  items: { description: string; unit: string; qty: number }[];
  issues: { severity: string; message: string }[];
  duplicateOf: string | null;
  lineMatches: {
    lineIndex: number;
    description: string;
    qty: number;
    match: { value: { id: string; description: string }; score: number; confident: boolean } | null;
  }[];
}

// Ported from attachChallanModal() — records a challan issued outside this
// system (e.g. Zoho). No balance-qty enforcement, since dispatch already
// happened externally. Includes the challan-copy file upload the prototype
// offers here (`zc_file`).
export function AttachChallanModal({
  project,
  editingId,
  onClose,
}: {
  project: ProjectViewModel;
  editingId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const uploadDoc = useUploadDocument();
  const editing = editingId ? project.challans.find((c) => c.id === editingId) : undefined;

  const [no, setNo] = useState(editing?.no ?? "");
  const [date, setDate] = useState(editing?.date ?? todayIso());
  const [manualValue, setManualValue] = useState(editing?.manualValue ?? 0);
  const [file, setFile] = useState<File | null>(null);
  const [qtyByItem, setQtyByItem] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    project.items.forEach((it) => {
      map[it.id] = editing?.items.find((ci) => ci.itemId === it.id)?.qty ?? 0;
    });
    return map;
  });

  const extraction = useExtractionJob();
  // Lines the AI read that could not be tied to a Sales Order item. Shown
  // rather than silently dropped: an unlinked line means dispatched material
  // that will not appear on a running bill.
  const [unmatched, setUnmatched] = useState<{ description: string; qty: number }[]>([]);
  const [aiNotes, setAiNotes] = useState<{ severity: string; message: string }[]>([]);
  const [duplicateWarning, setDuplicateWarning] = useState(false);

  /**
   * Same modal, same fields — the challan copy is now read by the AI and the
   * entries below are filled in, matched against this project's Sales Order
   * items. Everything stays editable; nothing saves until "Attach challan".
   */
  async function handleChallanFile(picked: File) {
    setFile(picked);
    setUnmatched([]);
    setAiNotes([]);
    setDuplicateWarning(false);

    const job = await extraction.start(picked, "challan", { projectId: project.id });
    if (!job?.result) return;

    const parsed = job.result as ChallanExtractionResult;

    // Only fill fields the user has not already set, so typed values win.
    if (parsed.no && !no.trim()) setNo(parsed.no);
    if (parsed.date) setDate(parsed.date);
    if (parsed.totalValue > 0 && !manualValue) setManualValue(parsed.totalValue);

    const nextQty: Record<string, number> = { ...qtyByItem };
    const stillUnmatched: { description: string; qty: number }[] = [];

    for (const line of parsed.lineMatches ?? []) {
      // Only auto-fill a confident match. A weak guess put into a quantity box
      // looks identical to a verified one once the modal is saved, and it
      // silently distorts that item's dispatched and pending figures.
      if (line.match?.confident) {
        nextQty[line.match.value.id] = (nextQty[line.match.value.id] ?? 0) + line.qty;
      } else {
        stillUnmatched.push({ description: line.description, qty: line.qty });
      }
    }

    setQtyByItem(nextQty);
    setUnmatched(stillUnmatched);
    setAiNotes(parsed.issues ?? []);
    setDuplicateWarning(Boolean(parsed.duplicateOf) && parsed.duplicateOf !== editingId);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!no.trim()) throw new Error("Challan number is required");
      const items = project.items
        .map((it) => ({ itemId: it.id, qty: qtyByItem[it.id] || 0 }))
        .filter((x) => x.qty > 0);
      const url = editingId ? `/api/challans/${editingId}` : `/api/projects/${project.id}/challans`;
      const res = await apiFetch<{ challan: { id: string } }>(url, {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify({ source: "ATTACHED_EXTERNAL", no, date, manualValue, items }),
      });
      if (file) {
        await uploadDoc.mutateAsync({ file, kind: "CHALLAN_COPY", projectId: project.id, challanId: res.challan.id });
      }
      return res;
    },
    onSuccess: () => {
      router.refresh();
      toast(editingId ? "Challan updated" : "Challan attached");
      onClose();
    },
    onError: (err) => toast(err instanceof Error ? err.message : "Failed to save challan"),
  });

  return (
    <Modal
      title={editingId ? "Edit attached challan" : "Attach Zoho challan"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => mutation.mutate()} disabled={mutation.isPending || uploadDoc.isPending}>
            {editingId ? "Save changes" : "Attach challan"}
          </Button>
        </>
      }
    >
      <FormRow>
        <FormField label="Challan number *">
          <TextInput value={no} onChange={(e) => setNo(e.target.value)} placeholder="As per Zoho" />
        </FormField>
        <FormField label="Date">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
        <FormField label="Challan value (₹, basic)">
          <TextInput type="number" min={0} value={manualValue} onChange={(e) => setManualValue(Number(e.target.value) || 0)} />
        </FormField>
      </FormRow>
      <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>
        Attach the challan copy (PDF or image) — it is read automatically and the entries below are filled in for you.
        If you enter the value above, it is added to &quot;material sent&quot;. Quantities linked to sales order items
        below are picked up by running bills automatically. Auto-read upload limit: {formatUploadLimit(MAX_AI_UPLOAD_BYTES)}.
      </p>
      <input
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          pickUploadFile(picked, (file) => void handleChallanFile(file), toast, MAX_AI_UPLOAD_BYTES);
        }}
      />
      {editing?.attachments && editing.attachments.length > 0 && (
        <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>
          Current attachment: {editing.attachments[0]!.fileName} (choose a new file to add another)
        </p>
      )}

      {extraction.phase.status === "running" && (
        <ExtractionProgress job={extraction.phase.job} />
      )}

      {extraction.phase.status === "failed" && (
        <p style={{ fontSize: 12.5, margin: "10px 0" }}>
          <Chip tone="red">Auto-read failed</Chip> {extraction.phase.message} — enter the challan manually below.
        </p>
      )}

      {extraction.phase.status === "done" && (
        <p style={{ fontSize: 12.5, margin: "10px 0" }}>
          <AiBadge>Challan read — quantities matched to the sales order below. Please verify before saving.</AiBadge>{" "}
          {duplicateWarning && (
            <Chip tone="red">A challan with this number already exists on this project.</Chip>
          )}
        </p>
      )}

      {unmatched.length > 0 && (
        <div style={{ fontSize: 12.5, margin: "10px 0" }}>
          <Chip tone="gold">
            {unmatched.length} line(s) could not be matched to a sales order item
          </Chip>
          <ul style={{ margin: "6px 0 0 0", paddingLeft: 18, color: "var(--muted)" }}>
            {unmatched.map((u, i) => (
              <li key={i}>
                {u.description} — {u.qty}
              </li>
            ))}
          </ul>
          <p style={{ color: "var(--muted)", marginTop: 4 }}>
            Enter these against the right item below, or record them through the challan value field.
          </p>
        </div>
      )}

      {aiNotes.length > 0 && (
        <ul style={{ fontSize: 12.5, margin: "10px 0", paddingLeft: 18, color: "var(--muted)" }}>
          {aiNotes.slice(0, 8).map((n, i) => (
            <li key={i} style={{ marginBottom: 3 }}>
              <Chip tone={n.severity === "error" ? "red" : "gold"}>{n.severity === "error" ? "Check" : "Note"}</Chip>{" "}
              {n.message}
            </li>
          ))}
        </ul>
      )}
      {project.items.length > 0 && (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Sales order item</Th>
                <Th align="r">Qty on this challan</Th>
              </tr>
            </thead>
            <tbody>
              {project.items.map((it) => (
                <tr key={it.id}>
                  <Td>
                    {it.description} ({it.unit})
                  </Td>
                  <Td align="r">
                    <TextInput
                      type="number"
                      min={0}
                      style={{ width: 90, textAlign: "right" }}
                      value={qtyByItem[it.id] ?? 0}
                      onChange={(e) => setQtyByItem((prev) => ({ ...prev, [it.id]: Number(e.target.value) || 0 }))}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Modal>
  );
}
