"use client";

import { useEffect, useState } from "react";
import { Modal } from "../Modal/Modal";
import { Button } from "../Button/Button";
import { TextInput } from "../Form/Inputs";
import { EmptyState } from "../Table/Table";
import { CustomerFormModal } from "./CustomerFormModal";
import styles from "./Customers.module.css";

export interface CustomerOption {
  id: string;
  name: string;
  phone: string | null;
  billing: string | null;
  delivery: string | null;
  refBy: string | null;
  salesPerson: string | null;
  gstin?: string | null;
}

// Shared customer chooser used by the project form and the quotation form.
// Searches server-side (debounced) so it stays fast no matter how many
// customers exist, and can create a new one inline without losing the flow.
export function CustomerPicker({
  onPick,
  onClose,
}: {
  onPick: (customer: CustomerOption) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<CustomerOption[]>([]);
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
        const res = await fetch(`/api/customers?options=1&q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!res.ok) throw new Error("Failed to load customers");
        const data = await res.json();
        if (!cancelled) setRows(data.customers ?? []);
      } catch (e) {
        // An aborted request is the previous keystroke being superseded, not a failure.
        if (!cancelled && (e as Error).name !== "AbortError") setError("Could not load customers.");
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

  if (creating) {
    return (
      <CustomerFormModal
        onClose={() => setCreating(false)}
        onSaved={(c) => onPick({ ...c, phone: null, gstin: null })}
      />
    );
  }

  return (
    <Modal
      title="Select customer"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => setCreating(true)}>
            + New customer
          </Button>
        </>
      }
    >
      <TextInput
        placeholder="Search customers…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
        aria-label="Search customers"
      />
      <div className={styles.pickerList}>
        {loading && <div className={styles.pickerNote}>Searching…</div>}
        {!loading && error && (
          <div className={styles.pickerNote} role="alert" style={{ color: "var(--danger)" }}>
            {error}
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <EmptyState>{q ? "No customer matches that search." : "No customers yet — create the first one."}</EmptyState>
        )}
        {!loading &&
          !error &&
          rows.map((c) => (
            <button key={c.id} type="button" className={styles.pickerRow} onClick={() => onPick(c)}>
              <span className={styles.pickerName}>
                {c.name}
                {c.refBy && <span className={styles.pickerMeta}>ref: {c.refBy}</span>}
              </span>
              <span className={styles.pickerMeta}>{c.phone || ""}</span>
            </button>
          ))}
      </div>
    </Modal>
  );
}
