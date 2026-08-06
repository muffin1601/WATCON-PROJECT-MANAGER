"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Modal } from "../Modal/Modal";
import { Button } from "../Button/Button";
import { TableWrap, Table, Th, Td } from "../Table/Table";
import { TextInput } from "../Form/Inputs";
import { inr } from "../../lib/format";
import { apiFetch } from "../../lib/apiClient";
import { useToast } from "../Toast/ToastProvider";
import type { ProjectViewModel } from "../../modules/projects/viewModel";

type Item = ProjectViewModel["items"][number];

interface SubRow {
  description: string;
  unit: string;
  qty: number;
  rate: number;
}

// Ported from splitItemModal(p, idx) — bifurcates a consolidated BOQ item
// into smaller items whose value must tally EXACTLY with the original
// (±₹1 rounding). Quantities already dispatched carry against the first
// sub-item.
export function SplitItemModal({
  projectId,
  item,
  onClose,
}: {
  projectId: string;
  item: Item;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const origAmt = item.qty * item.rate;

  const [rows, setRows] = useState<SubRow[]>([
    { description: item.description, unit: item.unit, qty: item.qty, rate: item.rate },
    { description: "", unit: item.unit, qty: 0, rate: 0 },
  ]);

  const subTotal = rows.reduce((t, w) => t + (Number(w.qty) || 0) * (Number(w.rate) || 0), 0);
  const diff = subTotal - origAmt;
  const tallies = Math.abs(diff) < 1;

  const update = (i: number, patch: Partial<SubRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/projects/${projectId}/items/${item.id}/split`, {
        method: "POST",
        body: JSON.stringify({ subs: rows.filter((w) => w.description.trim() && w.qty > 0) }),
      }),
    onSuccess: () => {
      router.refresh();
      toast(`Item split — total unchanged at ${inr(origAmt)}`);
      onClose();
    },
    onError: (err) => toast(err instanceof Error ? err.message : "Failed to split item"),
  });

  const save = () => {
    const subs = rows.filter((w) => w.description.trim() && w.qty > 0);
    if (subs.length < 2) {
      toast("Enter at least 2 sub-items with description and quantity");
      return;
    }
    if (!tallies) {
      toast(
        `The sub-items must total exactly the original item value (${inr(origAmt)}). Currently ${diff > 0 ? "over" : "short"} by ${inr(Math.abs(diff))}. A split bifurcates the item — it cannot add or remove value.`
      );
      return;
    }
    mutation.mutate();
  };

  return (
    <Modal
      title="Split item into smaller items"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={mutation.isPending}>
            Split item
          </Button>
        </>
      }
    >
      <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>
        Original item: <b>{item.description}</b> — {item.qty} {item.unit} × {inr(item.rate)} ={" "}
        <span className="money">{inr(origAmt)}</span>
      </p>
      {item.dispatchedQty > 0 && (
        <p style={{ fontSize: 12.5, color: "var(--warn)", marginBottom: 6 }}>
          <b>Note:</b> {item.dispatchedQty} {item.unit} already dispatched via challans — those quantities will be
          carried against the FIRST sub-item below.
        </p>
      )}
      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th style={{ width: "44%" }}>Description</Th>
              <Th>Unit</Th>
              <Th align="r">Qty</Th>
              <Th align="r">Rate</Th>
              <Th align="r">Amount</Th>
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
                <Td align="r" className="money">
                  {inr((Number(w.qty) || 0) * (Number(w.rate) || 0))}
                </Td>
                <Td>
                  <Button size="sm" variant="danger" type="button" disabled={rows.length <= 2} onClick={() => remove(i)}>
                    ×
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
      <Button size="sm" type="button" style={{ marginTop: 8 }} onClick={() => setRows((p) => [...p, { description: "", unit: item.unit, qty: 0, rate: 0 }])}>
        + Add sub-item
      </Button>
      <p style={{ fontWeight: 600, marginTop: 12 }}>
        Sub-items total: <span className="money">{inr(subTotal)}</span> — must equal the original{" "}
        <span className="money">{inr(origAmt)}</span> ·{" "}
        {tallies ? (
          <span style={{ color: "var(--ok)" }}>✓ Tallies</span>
        ) : (
          <span style={{ color: "var(--danger)" }}>
            {diff > 0 ? "Over" : "Short"} by {inr(Math.abs(diff))}
          </span>
        )}
      </p>
    </Modal>
  );
}
