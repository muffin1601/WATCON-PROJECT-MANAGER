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
import { todayIso } from "../../lib/format";
import type { ProjectViewModel } from "../../modules/projects/viewModel";

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
        Attach the challan copy (PDF or image). If you enter the value above, it is added to &quot;material sent&quot;.
        Alternatively, link quantities to sales order items below so running bills can pick them up automatically.
      </p>
      <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      {editing?.attachments && editing.attachments.length > 0 && (
        <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>
          Current attachment: {editing.attachments[0]!.fileName} (choose a new file to add another)
        </p>
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
