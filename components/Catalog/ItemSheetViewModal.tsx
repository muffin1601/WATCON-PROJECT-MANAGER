"use client";

import { useEffect, useState } from "react";
import { Modal } from "../Modal/Modal";
import { Button } from "../Button/Button";
import { Table, TableWrap, Td, Th } from "../Table/Table";
import { Chip } from "../Chip/Chip";
import { inr, dfmt } from "../../lib/format";
import type { CatalogItemDto } from "../../services/catalogService";
import type { ItemMasterWithStats } from "../../services/stockService";
import styles from "./Catalog.module.css";

// Ported from itemSheetView(c): the product's own details, its stock broken
// down by brand, and every project it appears on.
export function ItemSheetViewModal({
  item,
  onClose,
  onEdit,
}: {
  item: CatalogItemDto;
  onClose: () => void;
  onEdit: () => void;
}) {
  const [stocks, setStocks] = useState<ItemMasterWithStats[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/stocks");
        if (!res.ok) throw new Error("Failed to load stock");
        const data = await res.json();
        if (!cancelled) setStocks(data.items ?? []);
      } catch {
        if (!cancelled) setError("Could not load the stock figures.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const key = item.name.trim().toLowerCase();
  const rows = (stocks ?? []).filter((m) => m.name.trim().toLowerCase() === key);

  // Every project this item appears on, with required / issued / pending
  // aggregated across the brand rows.
  const projects = new Map<string, { project: string; client: string; required: number; delivered: number }>();
  rows.forEach((m) =>
    m.stats.rows.forEach((r) => {
      const cur = projects.get(r.projectId) ?? { project: r.project, client: r.client, required: 0, delivered: 0 };
      cur.required += r.required;
      cur.delivered += r.delivered;
      projects.set(r.projectId, cur);
    })
  );
  const projectRows = [...projects.values()];
  const totals = projectRows.reduce(
    (t, r) => ({
      required: t.required + r.required,
      delivered: t.delivered + r.delivered,
      pending: t.pending + Math.max(r.required - r.delivered, 0),
    }),
    { required: 0, delivered: 0, pending: 0 }
  );

  return (
    <Modal
      title={`Item sheet — ${item.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onEdit}>Edit item</Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {item.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- Supabase-hosted product photo, not a Next-optimised asset
          <img
            src={item.imageUrl}
            alt={item.name}
            style={{
              maxWidth: 200,
              maxHeight: 160,
              border: "1px solid var(--line)",
              borderRadius: 8,
              objectFit: "contain",
            }}
          />
        )}
        <div style={{ flex: 1, minWidth: 220, fontSize: 13.5, lineHeight: 1.9 }}>
          <b>Unit:</b> {item.unit}
          {item.category && (
            <>
              {" · "}
              <b>Category:</b> {item.category}
            </>
          )}
          {item.hsn && (
            <>
              {" · "}
              <b>HSN:</b> {item.hsn}
            </>
          )}
          <br />
          <b>Brands:</b>{" "}
          {item.makes.length ? item.makes.map((m) => <Chip key={m} tone="teal">{m}</Chip>) : "—"}
          {item.sellPrice != null && (
            <>
              <br />
              <b>Selling price:</b> {inr(item.sellPrice)} / {item.unit}
              {!!item.discountPct && (
                <>
                  {" · "}
                  <b>Std discount:</b> {item.discountPct}% · <b>Net:</b> {inr(item.netRate ?? 0)}
                </>
              )}
            </>
          )}
          {item.costRate != null && (
            <>
              <br />
              <b>Cost to us:</b> {inr(item.costRate)} / {item.unit}{" "}
              <span className={styles.note}>({item.costBasis})</span>
            </>
          )}
          {item.details && (
            <>
              <br />
              <b>Details:</b> {item.details}
            </>
          )}
          {item.components.length > 0 && (
            <>
              <br />
              <b>Parts per unit:</b>{" "}
              {item.components.map((c) => `${c.qty} × ${c.name}${c.make ? ` (${c.make})` : ""}`).join(", ")}
            </>
          )}
        </div>
      </div>

      <h4 style={{ fontSize: 13, margin: "16px 0 6px" }}>Stock by brand</h4>
      {error && (
        <p role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>
          {error}
        </p>
      )}
      {stocks === null && !error ? (
        <p className={styles.note}>Loading stock…</p>
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Brand</Th>
                <Th align="r">Stock in</Th>
                <Th align="r">Issued to sites</Th>
                <Th align="r">Current stock</Th>
                <Th align="r">Last purchase price</Th>
                <Th>Last bought from</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <Td colSpan={6} className={styles.note}>
                    No brand rows yet — add brands on the item sheet.
                  </Td>
                </tr>
              )}
              {rows.map((m) => (
                <tr key={m.id}>
                  <Td>
                    <b>{m.make || "(no brand)"}</b>
                  </Td>
                  <Td align="r">{m.stats.stockIn}</Td>
                  <Td align="r">{m.stats.del}</Td>
                  <Td
                    align="r"
                    style={{
                      color:
                        m.stats.current < 0 ? "var(--danger)" : m.stats.current > 0 ? "var(--ok)" : undefined,
                    }}
                  >
                    <b>{m.stats.current}</b>
                  </Td>
                  <Td align="r">{m.lastPurchase ? inr(m.lastPurchase.rate) : "—"}</Td>
                  <Td>
                    {m.lastPurchase ? (
                      <>
                        {m.lastPurchase.vendor || "—"}{" "}
                        <span className={styles.note}>{dfmt(m.lastPurchase.date)}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}

      <h4 style={{ fontSize: 13, margin: "16px 0 6px" }}>Projects this item is in</h4>
      {projectRows.length === 0 ? (
        <p className={styles.note}>Not on any project sales order yet.</p>
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Project</Th>
                <Th>Client</Th>
                <Th align="r">Required</Th>
                <Th align="r">Issued</Th>
                <Th align="r">Pending</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {projectRows.map((r) => {
                const pending = Math.max(r.required - r.delivered, 0);
                return (
                  <tr key={r.project}>
                    <Td>
                      <b>{r.project}</b>
                    </Td>
                    <Td>{r.client}</Td>
                    <Td align="r">{r.required}</Td>
                    <Td align="r">{r.delivered}</Td>
                    <Td align="r" style={{ color: pending ? "var(--warn)" : undefined }}>
                      {pending}
                    </Td>
                    <Td>
                      {r.delivered >= r.required && r.required > 0 ? (
                        <Chip tone="green">fully issued</Chip>
                      ) : r.delivered > 0 ? (
                        <Chip tone="teal">partly issued</Chip>
                      ) : (
                        <Chip tone="gold">not yet issued</Chip>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <Td colSpan={2} align="r">
                  Total
                </Td>
                <Td align="r">{totals.required}</Td>
                <Td align="r">{totals.delivered}</Td>
                <Td align="r">{totals.pending}</Td>
                <Td />
              </tr>
            </tfoot>
          </Table>
        </TableWrap>
      )}
    </Modal>
  );
}
