"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "../Modal/Modal";
import { Button } from "../Button/Button";
import { FormField, FormRow } from "../Form/FormField";
import { TextInput, Textarea } from "../Form/Inputs";
import { Table, TableWrap, Td, Th } from "../Table/Table";
import { useToast } from "../Toast/ToastProvider";
import { apiFetch, ApiError } from "../../lib/apiClient";
import { inr } from "../../lib/format";
import type { CatalogItemDto } from "../../services/catalogService";
import styles from "./Catalog.module.css";

interface ComponentRow {
  name: string;
  make: string;
  unit: string;
  qty: string;
}

const num = (v: string): number | null => {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Add / edit an Item Sheet product: identity, brands, both sides of the
// pricing (what we sell it for, what it costs us), and the bill of materials
// for assembly items.
export function CatalogItemModal({
  initial,
  presetName,
  onClose,
  onSaved,
}: {
  initial?: CatalogItemDto | null;
  presetName?: string;
  onClose: () => void;
  onSaved: (item: CatalogItemDto) => void;
}) {
  const editing = !!initial?.id;
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? presetName ?? "");
  const [unit, setUnit] = useState(initial?.unit ?? "Nos");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [hsn, setHsn] = useState(initial?.hsn ?? "");
  const [details, setDetails] = useState(initial?.details ?? "");
  const [makesText, setMakesText] = useState((initial?.makes ?? []).join(", "));
  const [sellPrice, setSellPrice] = useState(initial?.sellPrice != null ? String(initial.sellPrice) : "");
  const [discountPct, setDiscountPct] = useState(initial?.discountPct != null ? String(initial.discountPct) : "");
  const [purchasePrice, setPurchasePrice] = useState(initial?.purchasePrice != null ? String(initial.purchasePrice) : "");
  const [purchaseDiscPct, setPurchaseDiscPct] = useState(
    initial?.purchaseDiscPct != null ? String(initial.purchaseDiscPct) : ""
  );
  const [components, setComponents] = useState<ComponentRow[]>(
    (initial?.components ?? []).map((c) => ({ name: c.name, make: c.make, unit: c.unit, qty: String(c.qty) }))
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.imageUrl ?? null);
  const [imageBusy, setImageBusy] = useState(false);

  // Live previews so the user sees the effect of a discount as they type,
  // computed with the same formula the server stores.
  const netRate = useMemo(() => {
    const p = num(sellPrice);
    if (p === null) return null;
    return Math.round(p * (1 - (num(discountPct) ?? 0) / 100) * 100) / 100;
  }, [sellPrice, discountPct]);

  const netCost = useMemo(() => {
    const p = num(purchasePrice);
    if (p === null) return null;
    return Math.round(p * (1 - (num(purchaseDiscPct) ?? 0) / 100) * 100) / 100;
  }, [purchasePrice, purchaseDiscPct]);

  const setComp = (i: number, key: keyof ComponentRow, value: string) =>
    setComponents((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));

  const save = async () => {
    if (saving) return;
    if (!name.trim()) {
      setError("Item name is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        name,
        unit,
        category,
        hsn,
        details,
        makes: makesText
          .split(",")
          .map((m) => m.trim())
          .filter(Boolean),
        sellPrice: num(sellPrice),
        discountPct: num(discountPct),
        purchasePrice: num(purchasePrice),
        purchaseDiscPct: num(purchaseDiscPct),
        components: components
          .filter((c) => c.name.trim() && (num(c.qty) ?? 0) > 0)
          .map((c) => ({ name: c.name, make: c.make, unit: c.unit || "Nos", qty: num(c.qty) ?? 0 })),
      };
      const res = await apiFetch<{ item: CatalogItemDto }>(
        editing ? `/api/catalog/${initial!.id}` : "/api/catalog",
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(payload) }
      );
      toast(editing ? "Item updated" : "Item added to the sheet");
      onSaved(res.item);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={editing ? `Item details — ${initial!.name}` : "New item — Item Sheet"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save item"}
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 10 }}>
          {error}
        </p>
      )}

      <FormRow>
        <div style={{ gridColumn: "span 2" }}>
          <FormField label="Item name *">
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Pipe 63mm dia (uPVC 10kg)"
              autoFocus
            />
          </FormField>
        </div>
        <FormField label="Unit *">
          <TextInput value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Nos / Mtr / Sqft / Lot" />
        </FormField>
      </FormRow>

      <FormRow>
        <FormField label="Category">
          <TextInput
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. Filtration / Piping / Lighting"
          />
        </FormField>
        <FormField label="HSN code">
          <TextInput value={hsn} onChange={(e) => setHsn(e.target.value)} />
        </FormField>
      </FormRow>

      <div className={styles.priceBlock}>
        <FormRow>
          <FormField label="Selling price (₹ per unit, list rate)">
            <TextInput type="number" min={0} value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} />
          </FormField>
          <FormField label="Standard discount %">
            <TextInput
              type="number"
              min={0}
              max={100}
              value={discountPct}
              onChange={(e) => setDiscountPct(e.target.value)}
            />
          </FormField>
          <FormField label="Net rate after discount">
            <TextInput readOnly value={netRate === null ? "" : inr(netRate)} style={{ background: "#FAFBFB" }} />
          </FormField>
        </FormRow>
      </div>

      <div className={styles.priceBlock}>
        <FormRow>
          <FormField label="Purchase list price (₹ per unit)">
            <TextInput type="number" min={0} value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} />
          </FormField>
          <FormField label="Our purchase discount %">
            <TextInput
              type="number"
              min={0}
              max={100}
              value={purchaseDiscPct}
              onChange={(e) => setPurchaseDiscPct(e.target.value)}
            />
          </FormField>
          <FormField label="Net cost to us">
            <TextInput readOnly value={netCost === null ? "" : inr(netCost)} style={{ background: "#fff" }} />
          </FormField>
        </FormRow>
      </div>

      <FormField label="Brands / makes that manufacture this item (comma-separated)">
        <TextInput
          value={makesText}
          onChange={(e) => setMakesText(e.target.value)}
          placeholder="e.g. Finolex, Supreme, Astral"
        />
      </FormField>

      <FormField label="Item details / specification">
        <Textarea rows={4} value={details} onChange={(e) => setDetails(e.target.value)} />
      </FormField>

      {/* The photo is uploaded against a saved item, so it only appears once
          the item exists — a new item is saved first, then reopened to add one. */}
      {editing ? (
        <FormRow style={{ alignItems: "end" }}>
          <FormField label="Picture">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={imageBusy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setImageBusy(true);
                setError("");
                try {
                  const form = new FormData();
                  form.append("file", file);
                  const res = await fetch(`/api/catalog/${initial!.id}/image`, { method: "POST", body: form });
                  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Upload failed");
                  const fresh = await fetch(`/api/catalog/${initial!.id}`);
                  setImageUrl(((await fresh.json()).item as CatalogItemDto).imageUrl);
                  toast("Picture uploaded");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Upload failed");
                } finally {
                  setImageBusy(false);
                  e.target.value = "";
                }
              }}
            />
          </FormField>
          <div style={{ marginBottom: 14 }}>
            {imageBusy ? (
              <span className={styles.note}>Uploading…</span>
            ) : imageUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- Supabase-hosted product photo */}
                <img src={imageUrl} alt={name} className={styles.imagePreview} />{" "}
                <Button
                  size="sm"
                  variant="danger"
                  type="button"
                  onClick={async () => {
                    setImageBusy(true);
                    try {
                      const res = await fetch(`/api/catalog/${initial!.id}/image`, { method: "DELETE" });
                      if (!res.ok) throw new Error("Could not remove the picture");
                      setImageUrl(null);
                      toast("Picture removed");
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Could not remove the picture");
                    } finally {
                      setImageBusy(false);
                    }
                  }}
                >
                  Remove picture
                </Button>
              </>
            ) : (
              <span className={styles.note}>No picture yet</span>
            )}
          </div>
        </FormRow>
      ) : (
        <p className={styles.note}>Save the item first, then reopen it to add a picture.</p>
      )}

      <h4 style={{ fontSize: 13, margin: "6px 0" }}>Parts that make up this item (optional)</h4>
      <p className={styles.note}>
        Quantities are per ONE unit of this item — e.g. Jacuzzi 5 seater = 2 × pump, 5 × nozzle.
      </p>
      {components.length > 0 && (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Part</Th>
                <Th>Make</Th>
                <Th>Unit</Th>
                <Th align="r">Qty per unit</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {components.map((c, i) => (
                <tr key={i}>
                  <Td>
                    <TextInput value={c.name} onChange={(e) => setComp(i, "name", e.target.value)} />
                  </Td>
                  <Td>
                    <TextInput value={c.make} onChange={(e) => setComp(i, "make", e.target.value)} />
                  </Td>
                  <Td>
                    <TextInput value={c.unit} onChange={(e) => setComp(i, "unit", e.target.value)} style={{ width: 70 }} />
                  </Td>
                  <Td align="r">
                    <TextInput
                      type="number"
                      min={0}
                      value={c.qty}
                      onChange={(e) => setComp(i, "qty", e.target.value)}
                      style={{ width: 90, textAlign: "right" }}
                    />
                  </Td>
                  <Td>
                    <Button
                      size="sm"
                      variant="danger"
                      aria-label={`Remove part ${c.name || i + 1}`}
                      onClick={() => setComponents((rows) => rows.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
      <Button
        size="sm"
        style={{ marginTop: 8 }}
        onClick={() => setComponents((rows) => [...rows, { name: "", make: "", unit: "Nos", qty: "1" }])}
      >
        + Add part
      </Button>
    </Modal>
  );
}
