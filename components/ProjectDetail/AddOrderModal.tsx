"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Modal } from "../Modal/Modal";
import { Button } from "../Button/Button";
import { Chip } from "../Chip/Chip";
import { FormField, FormRow } from "../Form/FormField";
import { TextInput } from "../Form/Inputs";
import { ExtractionProgress } from "../ProgressBar/ExtractionProgress";
import { todayIso } from "../../lib/format";
import { apiFetch } from "../../lib/apiClient";
import { useToast } from "../Toast/ToastProvider";
import { useUploadDocument } from "../../hooks/useUploadDocument";
import { useExtractionJob } from "../../hooks/useExtractionJob";
import { MAX_AI_UPLOAD_BYTES, formatUploadLimit } from "../../modules/documents/uploadLimits";
import { pickUploadFile } from "../FileDrop/pickUploadFile";
import type { ProjectViewModel } from "../../modules/projects/viewModel";

interface ExtractedItem {
  description: string;
  unit: string;
  qty: number;
  rate: number;
  make?: string;
}

// Ported from addOrderModal(p) — adds an additional client order (PO/BOQ) to
// the project. If an order copy is attached, the document engine reads it and
// its items are created under the new order; without a file (or if reading
// fails) the order is saved and items can be added under it manually.
// Project terms (GST, transport, payment) stay as set for the project.
export function AddOrderModal({ project, onClose }: { project: ProjectViewModel; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const uploadDoc = useUploadDocument();
  const extraction = useExtractionJob();

  const [ref, setRef] = useState("");
  const [date, setDate] = useState(todayIso());
  const [file, setFile] = useState<File | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      let items: ExtractedItem[] = [];
      let partial = false;
      let aiFailed: string | null = null;

      if (file) {
        const job = await extraction.start(file, "order", { projectId: project.id });
        if (job && job.result) {
          const r = job.result as { items?: ExtractedItem[]; issues?: unknown[] };
          items = (r.items ?? []).map((it) => ({
            description: it.description,
            make: it.make || "",
            unit: it.unit || "Nos",
            qty: Number(it.qty) || 0,
            rate: Number(it.rate) || 0,
          }));
          partial = Boolean((r as { truncated?: boolean }).truncated);
        } else {
          aiFailed = "AI reading failed";
        }
      }

      const res = await apiFetch<{ order: { id: string } }>(`/api/projects/${project.id}/orders`, {
        method: "POST",
        body: JSON.stringify({ ref, date, items }),
      });
      if (file) {
        try {
          await uploadDoc.mutateAsync({
            file,
            kind: "ORDER_COPY",
            projectId: project.id,
            projectOrderId: res.order.id,
            allowDuplicate: true,
          });
        } catch {
          // Order + items are already saved; the attachment can be re-added
          // from the Documents tab, so don't fail the whole flow here.
        }
      }
      return { count: items.length, partial, aiFailed };
    },
    onSuccess: ({ count, partial, aiFailed }) => {
      router.refresh();
      if (aiFailed) {
        toast(`Order saved, but AI reading failed — add its items with the + Item button.`);
      } else if (count > 0) {
        toast(`${count} items added from ${ref}${partial ? " (partial — verify)" : ""}`);
      } else {
        toast("Order added — use + Item under it to enter items");
      }
      onClose();
    },
    onError: (err) => toast(err instanceof Error ? err.message : "Failed to add order"),
  });

  const save = () => {
    if (!ref.trim()) {
      toast("Order reference is required");
      return;
    }
    mutation.mutate();
  };

  return (
    <Modal
      title="Add new order to this project"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={mutation.isPending || uploadDoc.isPending}>
            Save order
          </Button>
        </>
      }
    >
      <FormRow>
        <FormField label="Order reference / PO number *">
          <TextInput value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. PO-2041 / Additional order for spa" />
        </FormField>
        <FormField label="Order date">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
      </FormRow>
      <FormField label="Order copy (PO / BOQ / approved quote — PDF, Excel, CSV or image)">
        <input
          type="file"
          accept="application/pdf,image/*,.xlsx,.xls,.csv"
          onChange={(e) => pickUploadFile(e.target.files?.[0], setFile, toast, MAX_AI_UPLOAD_BYTES)}
        />
      </FormField>
      <p style={{ fontSize: 12.5, color: "var(--muted)" }}>
        If you attach the order copy, the document engine reads it and adds its items to the sales order under this
        order. You can also save without a file and add items manually. Project terms (GST, transport, payment) stay as
        set for the project. Auto-read upload limit: below {formatUploadLimit(MAX_AI_UPLOAD_BYTES)}.
      </p>
      {extraction.phase.status === "running" && (
        <ExtractionProgress job={extraction.phase.job} />
      )}
      {extraction.phase.status === "failed" && (
        <p style={{ marginTop: 8 }}>
          <Chip tone="red">AI reading failed</Chip>{" "}
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{extraction.phase.message}</span>
        </p>
      )}
    </Modal>
  );
}
