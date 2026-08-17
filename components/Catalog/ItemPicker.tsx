"use client";

import { useEffect, useState } from "react";
import { Modal } from "../Modal/Modal";
import { Button } from "../Button/Button";
import { TextInput } from "../Form/Inputs";
import { EmptyState } from "../Table/Table";
import { CatalogItemModal } from "./CatalogItemModal";
import { inr } from "../../lib/format";
import styles from "./Catalog.module.css";

export interface CatalogOption {
  id: string;
  name: string;
  unit: string;
  category: string | null;
  details: string | null;
  makes: string[];
  sellPrice: number | null;
  discountPct: number | null;
  netRate: number | null;
  costRate: number | null;
}

// Shared item chooser. Every place in the app that puts a product on a
// document goes through this, so a line can never reference a product that
// isn't on the Item Sheet — the rule the business relies on to keep pricing
// and stock consistent.
export function ItemPicker({
  currentName,
  onPick,
  onClose,
}: {
  currentName?: string;
  onPick: (item: CatalogOption) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState(currentName ?? "");
  const [rows, setRows] = useState<CatalogOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/catalog?options=1&q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!res.ok) throw new Error("Failed to load the item sheet");
        const data = await res.json();
        if (!cancelled) setRows(data.items ?? []);
      } catch (e) {
        if (!cancelled && (e as Error).name !== "AbortError") setError("Could not load the item sheet.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [q]);

  const typed = q.trim();
  const exact = rows.some((r) => r.name.toLowerCase() === typed.toLowerCase());

  if (creating) {
    return (
      <CatalogItemModal
        presetName={typed}
        onClose={() => setCreating(false)}
        onSaved={(item) =>
          onPick({
            id: item.id,
            name: item.name,
            unit: item.unit,
            category: item.category,
            details: item.details,
            makes: item.makes,
            sellPrice: item.sellPrice,
            discountPct: item.discountPct,
            netRate: item.netRate,
            costRate: item.costRate,
          })
        }
      />
    );
  }

  return (
    <Modal
      title="Select item"
      onClose={onClose}
      footer={<Button onClick={onClose}>Cancel</Button>}
    >
      <TextInput
        placeholder="Search items… (or type a new name)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
        aria-label="Search the item sheet"
      />
      <div className={styles.pickerList}>
        {loading && <div className={styles.pickerNote}>Searching…</div>}
        {!loading && error && (
          <div className={styles.pickerNote} role="alert" style={{ color: "var(--danger)" }}>
            {error}
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <EmptyState>No item on the sheet matches that search.</EmptyState>
        )}
        {!loading &&
          !error &&
          rows.map((k) => (
            <button key={k.id} type="button" className={styles.pickerRow} onClick={() => onPick(k)}>
              <span className={styles.pickerName}>
                {k.name}
                {k.details && <span className={styles.pickerDetails}>{k.details}</span>}
              </span>
              <span className={styles.pickerMeta}>
                {k.unit}
                {k.makes.length ? ` · ${k.makes.join(" / ")}` : ""}
                {k.sellPrice != null
                  ? ` · list ${inr(k.sellPrice)}${k.discountPct ? ` (−${k.discountPct}%)` : ""}`
                  : ""}
              </span>
            </button>
          ))}
      </div>

      {typed && !exact && !loading && (
        <div style={{ marginTop: 10 }}>
          {rows.length > 0 && (
            <p className={styles.warn}>
              <b>Similar items already exist</b> — pick one above to avoid a duplicate.
            </p>
          )}
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
            Create &quot;{typed}&quot; as a new item…
          </Button>
        </div>
      )}
    </Modal>
  );
}
