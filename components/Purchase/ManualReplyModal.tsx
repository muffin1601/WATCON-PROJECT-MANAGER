"use client";

import { useState } from "react";
import { Modal } from "../Modal/Modal";
import { Button } from "../Button/Button";
import { FormField, FormRow } from "../Form/FormField";
import { TextInput, Select } from "../Form/Inputs";
import { Table, TableWrap, Td, Th } from "../Table/Table";
import { useToast } from "../Toast/ToastProvider";
import { apiFetch, ApiError } from "../../lib/apiClient";
import type { RfqDetail } from "../../services/rfqService";
import styles from "./Purchase.module.css";

// Ported from manualReplyModal(r) — for rates taken over the phone or from a
// paper quote, with the same fields as the supplier's own form.
export function ManualReplyModal({
  rfq,
  onClose,
  onSaved,
}: {
  rfq: RfqDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [vendorId, setVendorId] = useState(rfq.vendors[0]?.id ?? "");
  const [quotedBy, setQuotedBy] = useState("");
  const [ref, setRef] = useState("");
  const [transport, setTransport] = useState("0");
  const [transportGst, setTransportGst] = useState("18");
  const [delivery, setDelivery] = useState("");
  const [payment, setPayment] = useState("");
  const [rows, setRows] = useState(() =>
    rfq.rows.map((r) => ({ lineId: r.lineId, rate: "", gst: "18", remark: "" }))
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const setRow = (lineId: string, patch: Partial<{ rate: string; gst: string; remark: string }>) =>
    setRows((prev) => prev.map((r) => (r.lineId === lineId ? { ...r, ...patch } : r)));

  const save = async () => {
    if (busy) return;
    if (!vendorId) {
      setError("Choose a supplier");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/api/rfqs/${rfq.id}/responses`, {
        method: "POST",
        body: JSON.stringify({
          vendorId,
          quotedBy,
          ref,
          transport: Number(transport) || 0,
          transportGst: Number(transportGst) || 0,
          delivery,
          payment,
          manual: true,
          // A blank rate means "cannot supply", not zero.
          items: rows.map((r) => ({
            lineId: r.lineId,
            rate: r.rate === "" ? null : Number(r.rate) || 0,
            gst: Number(r.gst) || 0,
            remark: r.remark,
          })),
        }),
      });
      toast("Reply saved");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Enter supplier rates manually"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save reply"}
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <FormRow>
        <FormField label="Supplier">
          <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            {rfq.vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Quoted by">
          <TextInput value={quotedBy} onChange={(e) => setQuotedBy(e.target.value)} />
        </FormField>
        <FormField label="Their ref">
          <TextInput value={ref} onChange={(e) => setRef(e.target.value)} />
        </FormField>
      </FormRow>

      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th align="r">Qty</Th>
              <Th align="r">Rate</Th>
              <Th align="r">GST %</Th>
              <Th>Remark</Th>
            </tr>
          </thead>
          <tbody>
            {rfq.rows.map((l) => {
              const row = rows.find((r) => r.lineId === l.lineId)!;
              return (
                <tr key={l.lineId}>
                  <Td>
                    {l.name}
                    {l.make ? ` (${l.make})` : ""}
                  </Td>
                  <Td align="r">
                    {l.qty} {l.unit}
                  </Td>
                  <Td align="r">
                    <TextInput
                      type="number"
                      className={styles.rateInput}
                      value={row.rate}
                      onChange={(e) => setRow(l.lineId, { rate: e.target.value })}
                    />
                  </Td>
                  <Td align="r">
                    <TextInput
                      type="number"
                      className={styles.gstInput}
                      value={row.gst}
                      onChange={(e) => setRow(l.lineId, { gst: e.target.value })}
                    />
                  </Td>
                  <Td>
                    <TextInput value={row.remark} onChange={(e) => setRow(l.lineId, { remark: e.target.value })} />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </TableWrap>

      <FormRow style={{ marginTop: 10 }}>
        <FormField label="Transport (₹ lump sum)">
          <TextInput type="number" value={transport} onChange={(e) => setTransport(e.target.value)} />
        </FormField>
        <FormField label="GST on transport %">
          <TextInput type="number" value={transportGst} onChange={(e) => setTransportGst(e.target.value)} />
        </FormField>
        <FormField label="Delivery period">
          <TextInput value={delivery} onChange={(e) => setDelivery(e.target.value)} />
        </FormField>
        <FormField label="Payment terms">
          <TextInput value={payment} onChange={(e) => setPayment(e.target.value)} />
        </FormField>
      </FormRow>
    </Modal>
  );
}
