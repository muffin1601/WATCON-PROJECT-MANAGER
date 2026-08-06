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
import { todayIso } from "../../lib/format";
import { useToast } from "../Toast/ToastProvider";
import { useUploadDocument } from "../../hooks/useUploadDocument";
import { IssueChallanInput, ChallanExtraItemInput } from "../../modules/challans/schema";
import type { ProjectViewModel } from "../../modules/projects/viewModel";

interface RowState {
  itemId: string;
  description: string;
  unit: string;
  soQty: number;
  issuedOthers: number;
  balance: number;
  dispatchNow: number;
  extraQty: number;
}

// Ported from challanModal() — "Issue new challan". Enforces the same two
// rules the backend also enforces (defense in depth, matching the
// prototype's own inline validation UX):
//   - "Dispatch now" is capped to the item's balance qty.
//   - "Additional qty" (beyond BOQ) only unlocks once issuedOthers+dispatchNow
//     reaches the full Sales Order qty for that item.
export function IssueChallanModal({
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
  const editing = editingId ? project.challans.find((c) => c.id === editingId) : undefined;

  const [date, setDate] = useState(editing?.date ?? todayIso());
  const [vehicle, setVehicle] = useState(editing?.vehicle ?? "");
  const [driver, setDriver] = useState(editing?.driver ?? "");
  const [remarks, setRemarks] = useState(editing?.remarks ?? "");
  // Transport bill for this dispatch (prototype's ch_trt/ch_trr/ch_tra/ch_trf
  // fields) — recorded only when issuing a NEW challan, exactly as the
  // prototype (edits go through the Transport tab instead).
  const [trTransporter, setTrTransporter] = useState("");
  const [trRef, setTrRef] = useState("");
  const [trAmount, setTrAmount] = useState<number>(0);
  const [trFile, setTrFile] = useState<File | null>(null);
  const uploadDoc = useUploadDocument();
  const [extraItems, setExtraItems] = useState<ChallanExtraItemInput[]>(
    editing?.extraItems.map((x) => ({ description: x.description, unit: x.unit, qty: x.qty, rate: x.rate })) ?? []
  );

  const [rows, setRows] = useState<RowState[]>(() =>
    project.items.map((it) => {
      const prevOnThisChallan = editing?.items.find((ci) => ci.itemId === it.id);
      const issuedOthers = it.dispatchedQty - (prevOnThisChallan?.qty ?? 0);
      return {
        itemId: it.id,
        description: it.description,
        unit: it.unit,
        soQty: it.qty,
        issuedOthers,
        balance: it.qty - issuedOthers,
        dispatchNow: prevOnThisChallan?.qty ?? 0,
        extraQty: prevOnThisChallan?.extraQty ?? 0,
      };
    })
  );

  const setDispatchNow = (itemId: string, value: number) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.itemId !== itemId) return r;
        const v = Math.max(0, Math.min(value, r.balance));
        const full = r.issuedOthers + v >= r.soQty;
        return { ...r, dispatchNow: v, extraQty: full ? r.extraQty : 0 };
      })
    );
  };
  const setExtraQty = (itemId: string, value: number) => {
    setRows((prev) => prev.map((r) => (r.itemId === itemId ? { ...r, extraQty: Math.max(0, value) } : r)));
  };

  const addCustomRow = () => setExtraItems((prev) => [...prev, { description: "", unit: "Nos", qty: 1, rate: 0 }]);
  const updateCustomRow = (i: number, patch: Partial<ChallanExtraItemInput>) =>
    setExtraItems((prev) => prev.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeCustomRow = (i: number) => setExtraItems((prev) => prev.filter((_, idx) => idx !== i));

  const mutation = useMutation({
    mutationFn: async () => {
      const input: IssueChallanInput = {
        date,
        vehicle,
        driver,
        remarks,
        items: rows
          .filter((r) => r.dispatchNow > 0 || r.extraQty > 0)
          .map((r) => ({ itemId: r.itemId, qty: r.dispatchNow, extraQty: r.extraQty })),
        extraItems: extraItems.filter((x) => x.description.trim() && x.qty > 0),
      };
      const url = editingId ? `/api/challans/${editingId}` : `/api/projects/${project.id}/challans`;
      const res = await apiFetch<{ challan?: { id: string } }>(url, {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify({ source: "ISSUED_HERE", ...input }),
      });
      // Optional transport bill recorded against this dispatch (create only).
      if (!editingId && trAmount > 0 && res.challan) {
        const tr = await apiFetch<{ transport: { id: string } }>(`/api/projects/${project.id}/transports`, {
          method: "POST",
          body: JSON.stringify({
            date,
            amount: trAmount,
            transporter: trTransporter.trim(),
            ref: trRef.trim(),
            vehicle,
            challanId: res.challan.id,
          }),
        });
        if (trFile) {
          await uploadDoc.mutateAsync({ file: trFile, kind: "TRANSPORT_BILL", projectId: project.id, transportId: tr.transport.id });
        }
      }
      return res;
    },
    onSuccess: () => {
      router.refresh();
      toast(editingId ? "Challan updated" : "Challan issued");
      onClose();
    },
    onError: (err) => toast(err instanceof Error ? err.message : "Failed to save challan"),
  });

  return (
    <Modal
      title={editingId ? `Edit challan — ${editing?.no}` : "Issue new challan"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {editingId ? "Save changes" : "Save & issue challan"}
          </Button>
        </>
      }
    >
      <FormRow>
        <FormField label="Challan date">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
        <FormField label="Vehicle no.">
          <TextInput value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
        </FormField>
        <FormField label="Driver / contact">
          <TextInput value={driver} onChange={(e) => setDriver(e.target.value)} />
        </FormField>
      </FormRow>
      <FormField label="Remarks">
        <TextInput value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Filtration equipment lot 2" />
      </FormField>

      {rows.length > 0 && (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th>Unit</Th>
                <Th align="r">SO Qty</Th>
                <Th align="r">Already issued</Th>
                <Th align="r">Balance</Th>
                <Th align="r">Dispatch now</Th>
                <Th align="r">Additional qty</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const full = r.issuedOthers + r.dispatchNow >= r.soQty;
                return (
                  <tr key={r.itemId}>
                    <Td>{r.description}</Td>
                    <Td>{r.unit}</Td>
                    <Td align="r" className="money">{r.soQty}</Td>
                    <Td align="r" className="money">{r.issuedOthers}</Td>
                    <Td align="r" className="money">{r.balance}</Td>
                    <Td align="r">
                      <TextInput
                        type="number"
                        min={0}
                        style={{ width: 84, textAlign: "right" }}
                        value={r.dispatchNow}
                        onChange={(e) => setDispatchNow(r.itemId, Number(e.target.value) || 0)}
                      />
                    </Td>
                    <Td align="r">
                      <TextInput
                        type="number"
                        min={0}
                        disabled={!full}
                        title={full ? "" : "Enabled once the full sales order qty has been dispatched"}
                        style={{ width: 84, textAlign: "right", background: full ? undefined : "#EFF3F4" }}
                        value={r.extraQty}
                        onChange={(e) => setExtraQty(r.itemId, Number(e.target.value) || 0)}
                      />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}
      <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "8px 0 4px" }}>
        &quot;Dispatch now&quot; cannot exceed the balance quantity. &quot;Additional qty&quot; unlocks only once the full
        sales order quantity of that item has been dispatched — it is tracked and billed separately.
      </p>

      <h4 style={{ fontSize: 13, margin: "14px 0 6px" }}>Items not in the sales order</h4>
      {extraItems.map((x, i) => (
        <FormRow key={i}>
          <FormField label="Description">
            <TextInput value={x.description} onChange={(e) => updateCustomRow(i, { description: e.target.value })} />
          </FormField>
          <FormField label="Unit">
            <TextInput value={x.unit} onChange={(e) => updateCustomRow(i, { unit: e.target.value })} />
          </FormField>
          <FormField label="Qty">
            <TextInput
              type="number"
              min={0}
              value={x.qty}
              onChange={(e) => updateCustomRow(i, { qty: Number(e.target.value) || 0 })}
            />
          </FormField>
          <FormField label="Rate (₹, for billing)">
            <TextInput
              type="number"
              min={0}
              value={x.rate}
              onChange={(e) => updateCustomRow(i, { rate: Number(e.target.value) || 0 })}
            />
          </FormField>
          <FormField label=" ">
            <Button size="sm" variant="danger" type="button" onClick={() => removeCustomRow(i)}>
              Remove
            </Button>
          </FormField>
        </FormRow>
      ))}
      <Button size="sm" type="button" onClick={addCustomRow}>
        + Add item not in sales order
      </Button>

      {!editingId && (
        <>
          <h4 style={{ fontSize: 13, margin: "16px 0 6px" }}>Transport bill for this dispatch (optional)</h4>
          <FormRow>
            <FormField label="Transporter">
              <TextInput value={trTransporter} onChange={(e) => setTrTransporter(e.target.value)} />
            </FormField>
            <FormField label="Bill / LR number">
              <TextInput value={trRef} onChange={(e) => setTrRef(e.target.value)} />
            </FormField>
            <FormField label="Amount (₹)">
              <TextInput type="number" min={0} value={trAmount || ""} onChange={(e) => setTrAmount(Number(e.target.value) || 0)} />
            </FormField>
            <FormField label="Bill copy">
              <input type="file" accept="application/pdf,image/*" onChange={(e) => setTrFile(e.target.files?.[0] ?? null)} />
            </FormField>
          </FormRow>
          <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: -6 }}>
            {project.termsTransport === "EXTRA"
              ? "Transport is EXTRA on this project — this bill will be added to the client’s running bill at actuals."
              : "Transport is INCLUDED in rates on this project — this bill is recorded as internal cost only."}
          </p>
        </>
      )}
    </Modal>
  );
}
