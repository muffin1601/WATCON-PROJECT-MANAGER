"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { BackLink } from "../BackLink/BackLink";
import { Card, CardBody, CardHeader, CardTitle } from "../Card/Card";
import { StatsGrid } from "../StatsGrid/StatsGrid";
import { StatCard } from "../StatCard/StatCard";
import { Table, TableWrap, Td, Th } from "../Table/Table";
import { Button } from "../Button/Button";
import { Chip, type ChipTone } from "../Chip/Chip";
import { FormField, FormRow } from "../Form/FormField";
import { TextInput, Select, Textarea } from "../Form/Inputs";
import { PoDoc } from "../PrintDoc/PurchaseDocs";
import type { CompanySettings } from "../PrintDoc/DocHead";
import { useToast } from "../Toast/ToastProvider";
import { usePrintPortal } from "../../hooks/usePrintPortal";
import { apiFetch, ApiError } from "../../lib/apiClient";
import { inr, dfmt } from "../../lib/format";
import { PO_STATUS_LABEL, PO_STATUSES } from "../../modules/purchase/schema";
import type { PoDetail } from "../../services/purchaseOrderService";
import styles from "./Purchase.module.css";

const PO_TONE: Record<string, ChipTone> = {
  DRAFT: "grey",
  ISSUED: "teal",
  PARTIALLY_RECEIVED: "gold",
  COMPLETED: "green",
  CANCELLED: "red",
};

// Ported from renderPo() — stats row, editable item table with a Received
// column, supplier terms, and the printed PO.
export function PoDetailClient({ po, settings }: { po: PoDetail; settings: CompanySettings }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { target: printTarget, printArea, print } = usePrintPortal<true>();

  // Local edit buffers so a field only saves on blur/change, not per keystroke.
  const [received, setReceived] = useState<Record<string, string>>(() =>
    Object.fromEntries(po.lines.map((l) => [l.id, String(l.receivedQty)]))
  );

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const patch = (body: Record<string, unknown>) =>
    run(async () => {
      await apiFetch(`/api/purchase-orders/${po.id}`, { method: "PATCH", body: JSON.stringify(body) });
      router.refresh();
    });

  // Received quantity is the TOTAL to date; the server posts only the change,
  // so re-saving the same figure never double-counts into stock.
  const postReceipt = (lineId: string, value: string) =>
    run(async () => {
      const qty = Number(value) || 0;
      const res = await apiFetch<{ delta: number }>(`/api/purchase-orders/${po.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "receipt", lineId, receivedQty: qty }),
      });
      const line = po.lines.find((l) => l.id === lineId);
      if (res.delta === 0) toast("No change — nothing posted to stock");
      else
        toast(
          `Receipt posted to stock (${res.delta > 0 ? "+" : ""}${res.delta} ${line?.unit ?? ""} ${line?.name ?? ""})`
        );
      router.refresh();
    });

  const t = po.totals;

  return (
    <>
      <BackLink href="/purchase">Purchase</BackLink>

      <div className={styles.head}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h2>
            Purchase Order {po.poNumber} <Chip tone={PO_TONE[po.status] ?? "grey"}>{PO_STATUS_LABEL[po.status]}</Chip>
          </h2>
          <div className={styles.note} style={{ marginTop: 4 }}>
            {dfmt(po.date)} · To <b>{po.vendor.name}</b>
            {po.rfq ? ` · against RFQ ${po.rfq.no}` : ""}
          </div>
        </div>
        <Select
          style={{ width: "auto" }}
          aria-label="Purchase order status"
          value={po.status}
          disabled={busy}
          onChange={(e) => patch({ status: e.target.value })}
        >
          {PO_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PO_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="primary" onClick={() => print(true)}>
          Print PO
        </Button>
      </div>

      <div style={{ marginTop: 16 }}>
        <StatsGrid>
          <StatCard label="Basic" value={inr(t.basic)} />
          <StatCard label="GST" value={inr(t.gst)} />
          <StatCard label="Transport (+GST)" value={inr(t.transport + t.transportGst)} />
          <StatCard label="PO value" value={inr(t.total)} highlight />
        </StatsGrid>
      </div>

      <Card style={{ marginTop: 16 }}>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardBody>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th>Make</Th>
                  <Th>Unit</Th>
                  <Th align="r">Qty</Th>
                  <Th align="r">Rate</Th>
                  <Th align="r">GST %</Th>
                  <Th align="r">Amount</Th>
                  <Th>For projects</Th>
                  <Th align="r">Received</Th>
                </tr>
              </thead>
              <tbody>
                {po.lines.map((l) => (
                  <tr key={l.id}>
                    <Td>
                      <b>{l.name}</b>
                      {l.remark && <div className={styles.sub}>{l.remark}</div>}
                    </Td>
                    <Td>{l.make || "—"}</Td>
                    <Td>{l.unit}</Td>
                    <Td align="r">
                      <TextInput
                        type="number"
                        className={styles.qtyInput}
                        defaultValue={l.qty}
                        disabled={busy}
                        onBlur={(e) => patch({ lines: [{ id: l.id, qty: Number(e.target.value) || 0, rate: l.rate }] })}
                      />
                    </Td>
                    <Td align="r">
                      <TextInput
                        type="number"
                        className={styles.rateInput}
                        defaultValue={l.rate}
                        disabled={busy}
                        onBlur={(e) => patch({ lines: [{ id: l.id, qty: l.qty, rate: Number(e.target.value) || 0 }] })}
                      />
                    </Td>
                    <Td align="r">
                      <TextInput
                        type="number"
                        className={styles.gstInput}
                        defaultValue={l.gst}
                        disabled={busy}
                        onBlur={(e) => patch({ lines: [{ id: l.id, gst: Number(e.target.value) || 0 }] })}
                      />
                    </Td>
                    <Td align="r">{inr(l.qty * l.rate)}</Td>
                    <Td className={styles.sub}>{l.projectNames.join(", ")}</Td>
                    <Td align="r">
                      <TextInput
                        type="number"
                        min={0}
                        className={styles.qtyInput}
                        title="Qty received — the difference is added to stock for this make"
                        value={received[l.id] ?? ""}
                        disabled={busy}
                        onChange={(e) => setReceived((prev) => ({ ...prev, [l.id]: e.target.value }))}
                        onBlur={(e) => {
                          if (Number(e.target.value) === l.receivedQty) return;
                          void postReceipt(l.id, e.target.value);
                        }}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>

          <FormRow style={{ marginTop: 12 }}>
            <FormField label="Transport (₹)">
              <TextInput
                type="number"
                defaultValue={po.transport}
                disabled={busy}
                onBlur={(e) => patch({ transport: Number(e.target.value) || 0 })}
              />
            </FormField>
            <FormField label="GST on transport %">
              <TextInput
                type="number"
                defaultValue={po.transportGstPct}
                disabled={busy}
                onBlur={(e) => patch({ transportGst: Number(e.target.value) || 0 })}
              />
            </FormField>
            <FormField label="Delivery period">
              <TextInput defaultValue={po.delivery} disabled={busy} onBlur={(e) => patch({ delivery: e.target.value })} />
            </FormField>
            <FormField label="Payment terms">
              <TextInput defaultValue={po.payment} disabled={busy} onBlur={(e) => patch({ payment: e.target.value })} />
            </FormField>
          </FormRow>
          <FormField label="Deliver to">
            <TextInput defaultValue={po.deliverTo} disabled={busy} onBlur={(e) => patch({ deliverTo: e.target.value })} />
          </FormField>
          <FormField label="Notes / terms on PO">
            <Textarea rows={2} defaultValue={po.remarks} disabled={busy} onBlur={(e) => patch({ remarks: e.target.value })} />
          </FormField>

          <p className={styles.note}>
            Received quantities are posted to stock (Items &amp; Stocks) as purchases at the PO rate, brand-wise — so the
            last purchase price and stock update automatically.
          </p>
        </CardBody>
      </Card>

      {printTarget && printArea ? createPortal(<PoDoc settings={settings} po={po} />, printArea) : null}
    </>
  );
}
