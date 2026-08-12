"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Modal } from "../Modal/Modal";
import { Button } from "../Button/Button";
import { TableWrap, Table, Th, Td } from "../Table/Table";
import { TextInput } from "../Form/Inputs";
import { FormField, FormRow } from "../Form/FormField";
import { inr, todayIso } from "../../lib/format";
import { apiFetch } from "../../lib/apiClient";
import { useToast } from "../Toast/ToastProvider";
import { useUploadDocument } from "../../hooks/useUploadDocument";
import { MAX_DOCUMENT_UPLOAD_BYTES, formatUploadLimit } from "../../modules/documents/uploadLimits";
import { pickUploadFile } from "../FileDrop/pickUploadFile";
import type { ProjectViewModel } from "../../modules/projects/viewModel";

interface WorkRow {
  id: string | null;
  description: string;
  make: string;
  unit: string;
  qty: number;
  rate: number;
  orderId: string | null;
}

// Ported from amendSOModal(p) — edit qty/rates/descriptions, remove or add
// items; on save the value difference is recorded automatically as an
// "applied" amendment, with an optional client approval copy attached.
export function AmendSalesOrderModal({ project, onClose }: { project: ProjectViewModel; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const uploadDoc = useUploadDocument();

  const oldBase = project.financials.orderBase;
  const [rows, setRows] = useState<WorkRow[]>(
    project.items.map((it) => ({
      id: it.id,
      description: it.description,
      make: it.make,
      unit: it.unit,
      qty: it.qty,
      rate: it.rate,
      orderId: it.orderId,
    }))
  );
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayIso());
  const [file, setFile] = useState<File | null>(null);

  const newBase = rows.reduce((t, w) => t + (Number(w.qty) || 0) * (Number(w.rate) || 0), 0);
  const diff = newBase - oldBase;

  const update = (i: number, patch: Partial<WorkRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch<{ amendment: { id: string } }>(`/api/projects/${project.id}/amend-so`, {
        method: "POST",
        body: JSON.stringify({ note, date, items: rows }),
      });
      if (file) {
        await uploadDoc.mutateAsync({
          file,
          kind: "AMENDMENT_APPROVAL",
          projectId: project.id,
          amendmentId: res.amendment.id,
        });
      }
    },
    onSuccess: () => {
      router.refresh();
      toast(`Sales order amended — change of ${inr(diff)} recorded in Amendments`);
      onClose();
    },
    onError: (err) => toast(err instanceof Error ? err.message : "Failed to amend sales order"),
  });

  const save = () => {
    if (!note.trim()) {
      toast("Amendment note is required");
      return;
    }
    mutation.mutate();
  };

  return (
    <Modal
      title="Amend sales order"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={mutation.isPending || uploadDoc.isPending}>
            Save amendment
          </Button>
        </>
      }
    >
      <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>
        Change quantities, rates or descriptions, remove items, or add new ones. On save, the value difference is
        recorded automatically in Amendments, and you can attach the client&apos;s approval of the amendment.
      </p>
      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th style={{ width: "44%" }}>Description</Th>
              <Th>Unit</Th>
              <Th align="r">Qty</Th>
              <Th align="r">Rate</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w, i) => (
              <tr key={i}>
                <Td>
                  <TextInput value={w.description} onChange={(e) => update(i, { description: e.target.value })} />
                </Td>
                <Td>
                  <TextInput style={{ width: 64 }} value={w.unit} onChange={(e) => update(i, { unit: e.target.value })} />
                </Td>
                <Td align="r">
                  <TextInput
                    type="number"
                    step="any"
                    style={{ width: 84, textAlign: "right" }}
                    value={w.qty}
                    onChange={(e) => update(i, { qty: Number(e.target.value) || 0 })}
                  />
                </Td>
                <Td align="r">
                  <TextInput
                    type="number"
                    step="any"
                    style={{ width: 104, textAlign: "right" }}
                    value={w.rate}
                    onChange={(e) => update(i, { rate: Number(e.target.value) || 0 })}
                  />
                </Td>
                <Td>
                  <Button size="sm" variant="danger" type="button" onClick={() => setRows((p) => p.filter((_, idx) => idx !== i))}>
                    ×
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
      <Button
        size="sm"
        type="button"
        style={{ marginTop: 8 }}
        onClick={() => setRows((p) => [...p, { id: null, description: "", make: "", unit: "Nos", qty: 1, rate: 0, orderId: null }])}
      >
        + Add item
      </Button>
      <FormRow style={{ marginTop: 14 }}>
        <FormField label="Amendment note *">
          <TextInput
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Pool cover upgraded, piping qty revised as per site"
          />
        </FormField>
        <FormField label="Date">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
      </FormRow>
      <FormField label="Approval copy (PO amendment / email / WhatsApp — optional)">
        <input type="file" accept="application/pdf,image/*" onChange={(e) => pickUploadFile(e.target.files?.[0], setFile, toast)} />
      </FormField>
      <p className="note">Maximum file size: {formatUploadLimit(MAX_DOCUMENT_UPLOAD_BYTES)}</p>
      <p style={{ fontWeight: 600 }}>
        Current basic value: <span className="money">{inr(oldBase)}</span> → Amended:{" "}
        <span className="money">{inr(newBase)}</span> · Change:{" "}
        <span className="money" style={{ color: diff < 0 ? "var(--danger)" : diff > 0 ? "var(--ok)" : "inherit" }}>
          {diff >= 0 ? "+" : "−"} {inr(Math.abs(diff))}
        </span>
      </p>
    </Modal>
  );
}
