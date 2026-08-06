"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { Card, CardBody, CardHeader } from "../Card/Card";
import { StatsGrid } from "../StatsGrid/StatsGrid";
import { StatCard } from "../StatCard/StatCard";
import { TableWrap, Table, Th, Td, EmptyState } from "../Table/Table";
import { TextInput } from "../Form/Inputs";
import { Button } from "../Button/Button";
import { Chip } from "../Chip/Chip";
import { Modal } from "../Modal/Modal";
import { ConfirmModal } from "../Modal/ConfirmModal";
import { FormField, FormRow } from "../Form/FormField";
import { ItemDoc, StockReportDoc, type StockItemView } from "../PrintDoc/StockDocs";
import { usePrintPortal } from "../../hooks/usePrintPortal";
import { dfmt, todayIso } from "../../lib/format";
import { apiFetch } from "../../lib/apiClient";
import { useToast } from "../Toast/ToastProvider";
import type { CompanySettings } from "../PrintDoc/DocHead";

type PrintTarget = { kind: "report" } | { kind: "item"; item: StockItemView };

// Ported from renderStocks() — Items & Stocks page: items are created
// automatically the moment they appear on any sales order (one entry per
// item per make); current stock = stock-in entries − quantities dispatched
// to sites via challans.
export function StocksClient({ items, settings }: { items: StockItemView[]; settings: CompanySettings }) {
  const router = useRouter();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [stockFor, setStockFor] = useState<StockItemView | null>(null);
  const [detailFor, setDetailFor] = useState<StockItemView | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const { target, printArea, print } = usePrintPortal<PrintTarget>();

  // Add item modal state
  const [imName, setImName] = useState("");
  const [imMake, setImMake] = useState("");
  const [imUnit, setImUnit] = useState("Nos");

  // Stock entry modal state
  const [seDate, setSeDate] = useState(todayIso());
  const [seQty, setSeQty] = useState<number>(0);
  const [seNote, setSeNote] = useState("");

  const low = items.filter((x) => x.stats.current < 0).length;
  const pendingAll = items.reduce((t, x) => t + x.stats.pending, 0);
  const filtered = items.filter((x) => !search || (x.name + " " + x.make).toLowerCase().includes(search.toLowerCase()));

  const addMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/stocks", { method: "POST", body: JSON.stringify({ name: imName, make: imMake, unit: imUnit }) }),
    onSuccess: () => {
      router.refresh();
      setAddOpen(false);
      setImName("");
      setImMake("");
      setImUnit("Nos");
    },
    onError: (err) => toast(err instanceof Error ? err.message : "Failed to add item"),
  });

  const entryMutation = useMutation({
    mutationFn: (itemId: string) =>
      apiFetch(`/api/stocks/${itemId}/entries`, {
        method: "POST",
        body: JSON.stringify({ date: seDate, qty: seQty, note: seNote }),
      }),
    onSuccess: () => {
      router.refresh();
      setStockFor(null);
      setSeDate(todayIso());
      setSeQty(0);
      setSeNote("");
      toast("Stock entry saved");
    },
    onError: (err) => toast(err instanceof Error ? err.message : "Failed to save stock entry"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/stocks/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      router.refresh();
      setConfirmDeleteId(null);
    },
    onError: () => toast("Failed to delete item"),
  });

  const openStockEntry = (m: StockItemView) => {
    setSeDate(todayIso());
    setSeQty(0);
    setSeNote("");
    setStockFor(m);
  };

  return (
    <>
      <StatsGrid>
        <StatCard label="Items (make-wise)" value={String(items.length)} highlight />
        <StatCard label="Pending delivery (all items)" value={String(pendingAll)} />
        <StatCard label="Items short of stock" value={String(low)} tone={low ? "neg" : undefined} />
      </StatsGrid>

      <Card style={{ marginTop: 20 }}>
        <CardHeader>
          <h3>Items &amp; Stocks</h3>
          <TextInput
            placeholder="Search item / make…"
            style={{ maxWidth: 260, marginLeft: "auto" }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button size="sm" onClick={() => setAddOpen(true)}>
            + Add item manually
          </Button>
          <Button size="sm" variant="primary" onClick={() => print({ kind: "report" })}>
            Print stock report
          </Button>
        </CardHeader>
        <CardBody>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th>Make</Th>
                  <Th>Unit</Th>
                  <Th align="r">Required (all projects)</Th>
                  <Th align="r">Delivered</Th>
                  <Th align="r">Pending</Th>
                  <Th align="r">Stock in</Th>
                  <Th align="r">Current stock</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <Td colSpan={9}>
                      <EmptyState>No items yet — they appear here automatically when added to a sales order.</EmptyState>
                    </Td>
                  </tr>
                ) : (
                  filtered.map((m) => (
                    <tr key={m.id}>
                      <Td>
                        <b>{m.name}</b>
                      </Td>
                      <Td>{m.make ? <Chip tone="teal">{m.make}</Chip> : "—"}</Td>
                      <Td>{m.unit}</Td>
                      <Td align="r" className="money">{m.stats.req}</Td>
                      <Td align="r" className="money">{m.stats.del}</Td>
                      <Td align="r" className="money" style={{ color: m.stats.pending ? "var(--warn)" : "inherit" }}>
                        {m.stats.pending}
                      </Td>
                      <Td align="r" className="money">{m.stats.stockIn}</Td>
                      <Td
                        align="r"
                        className="money"
                        style={{ color: m.stats.current < 0 ? "var(--danger)" : m.stats.current > 0 ? "var(--ok)" : "inherit" }}
                      >
                        <b>{m.stats.current}</b>
                      </Td>
                      <Td style={{ whiteSpace: "nowrap" }}>
                        <Button size="sm" onClick={() => setDetailFor(m)}>
                          View / Print
                        </Button>{" "}
                        <Button size="sm" onClick={() => openStockEntry(m)}>
                          + Stock
                        </Button>{" "}
                        <Button size="sm" variant="danger" aria-label={`Delete ${m.name}`} onClick={() => setConfirmDeleteId(m.id)}>
                          ×
                        </Button>
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </TableWrap>
          <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>
            Items are created automatically the moment they are added to any sales order — one entry per item per make.
            Current stock = stock-in entries − quantities dispatched to sites via challans.
          </p>
        </CardBody>
      </Card>

      {addOpen && (
        <Modal
          title="Add item to master"
          onClose={() => setAddOpen(false)}
          footer={
            <>
              <Button onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={addMutation.isPending}
                onClick={() => {
                  if (!imName.trim()) {
                    toast("Item name is required");
                    return;
                  }
                  addMutation.mutate();
                }}
              >
                Add item
              </Button>
            </>
          }
        >
          <FormRow>
            <FormField label="Item name *">
              <TextInput value={imName} onChange={(e) => setImName(e.target.value)} />
            </FormField>
            <FormField label="Make / brand">
              <TextInput value={imMake} onChange={(e) => setImMake(e.target.value)} placeholder="e.g. Finolex" />
            </FormField>
            <FormField label="Unit">
              <TextInput value={imUnit} onChange={(e) => setImUnit(e.target.value)} />
            </FormField>
          </FormRow>
        </Modal>
      )}

      {stockFor && (
        <Modal
          title={`Stock entry — ${stockFor.name}${stockFor.make ? ` (${stockFor.make})` : ""}`}
          onClose={() => setStockFor(null)}
          footer={
            <>
              <Button onClick={() => setStockFor(null)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={entryMutation.isPending}
                onClick={() => {
                  if (!seQty) {
                    toast("Enter quantity");
                    return;
                  }
                  entryMutation.mutate(stockFor.id);
                }}
              >
                Save entry
              </Button>
            </>
          }
        >
          <FormRow>
            <FormField label="Date">
              <TextInput type="date" value={seDate} onChange={(e) => setSeDate(e.target.value)} />
            </FormField>
            <FormField label="Qty (use minus for outward adjustment) *">
              <TextInput type="number" step="any" value={seQty || ""} onChange={(e) => setSeQty(Number(e.target.value) || 0)} />
            </FormField>
          </FormRow>
          <FormField label="Note (vendor / invoice ref / reason)">
            <TextInput
              value={seNote}
              onChange={(e) => setSeNote(e.target.value)}
              placeholder="e.g. Purchased from Finolex dealer, Inv 2211"
            />
          </FormField>
        </Modal>
      )}

      {detailFor && (
        <Modal
          title={detailFor.name + (detailFor.make ? ` — ${detailFor.make}` : "")}
          onClose={() => setDetailFor(null)}
          footer={
            <>
              <Button
                onClick={() => {
                  const m = detailFor;
                  setDetailFor(null);
                  openStockEntry(m);
                }}
              >
                + Stock entry
              </Button>
              <Button
                onClick={() => {
                  const m = detailFor;
                  setDetailFor(null);
                  print({ kind: "item", item: m });
                }}
              >
                Print item report
              </Button>
              <Button variant="primary" onClick={() => setDetailFor(null)}>
                Close
              </Button>
            </>
          }
        >
          <StatsGrid>
            <StatCard label="Required" value={String(detailFor.stats.req)} />
            <StatCard label="Delivered" value={String(detailFor.stats.del)} />
            <StatCard label="Pending" value={String(detailFor.stats.pending)} />
            <StatCard
              label="Current stock"
              value={`${detailFor.stats.current} ${detailFor.unit}`}
              highlight
              tone={detailFor.stats.current < 0 ? "neg" : undefined}
            />
          </StatsGrid>
          {detailFor.stats.rows.length > 0 ? (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Project</Th>
                    <Th>Site</Th>
                    <Th align="r">Required</Th>
                    <Th align="r">Delivered</Th>
                    <Th align="r">Pending</Th>
                  </tr>
                </thead>
                <tbody>
                  {detailFor.stats.rows.map((r) => (
                    <tr key={r.projectId}>
                      <Td>
                        {r.project}
                        <br />
                        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{r.client}</span>
                      </Td>
                      <Td>{r.site}</Td>
                      <Td align="r" className="money">{r.required}</Td>
                      <Td align="r" className="money">{r.delivered}</Td>
                      <Td align="r" className="money" style={{ color: r.pending ? "var(--warn)" : "inherit" }}>
                        {r.pending}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          ) : (
            <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>This item is not on any sales order yet.</p>
          )}
          {detailFor.entries.length > 0 && (
            <>
              <h4 style={{ fontSize: 13, margin: "14px 0 6px" }}>Stock entries</h4>
              {detailFor.entries.map((e) => (
                <div key={e.id} className="att" style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                  <span style={{ flex: 1, fontWeight: 600 }}>{e.note || "Stock entry"}</span>
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>{dfmt(e.date)}</span>
                  <span className="money">
                    {e.qty > 0 ? "+" : ""}
                    {e.qty}
                  </span>
                </div>
              ))}
            </>
          )}
        </Modal>
      )}

      {confirmDeleteId && (
        <ConfirmModal
          message="Delete this item from the master? It will reappear automatically if it is still on any sales order."
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={() => deleteMutation.mutate(confirmDeleteId)}
        />
      )}

      {printArea &&
        target &&
        createPortal(
          target.kind === "report" ? (
            <StockReportDoc settings={settings} items={items} dfmt={dfmt} today={todayIso()} />
          ) : (
            <ItemDoc settings={settings} item={target.item} dfmt={dfmt} today={todayIso()} />
          ),
          printArea
        )}
    </>
  );
}
