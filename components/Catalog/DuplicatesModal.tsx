"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "../Modal/Modal";
import { Button } from "../Button/Button";
import { EmptyState } from "../Table/Table";
import { useToast } from "../Toast/ToastProvider";
import { apiFetch, ApiError } from "../../lib/apiClient";
import styles from "./Catalog.module.css";

// Ported from dupesModal(): each group is a set of names that look like the
// same product. Pick the one to keep and everything using the others is
// renamed to it — quantities and values are untouched.
export function DuplicatesModal({ onClose, onMerged }: { onClose: () => void; onMerged: () => void }) {
  const toast = useToast();
  const [groups, setGroups] = useState<string[][] | null>(null);
  const [keep, setKeep] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/catalog/duplicates");
      if (!res.ok) throw new Error("Failed to check for duplicates");
      const data = await res.json();
      setGroups(data.groups ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const merge = async (gi: number, group: string[]) => {
    const keepName = keep[gi];
    if (!keepName) {
      setError("Select the name to keep");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch<{ renamed: number }>("/api/catalog/duplicates", {
        method: "POST",
        body: JSON.stringify({ keep: keepName, merge: group.filter((n) => n !== keepName) }),
      });
      toast(`${res.renamed} line(s) renamed to "${keepName}"`);
      await load();
      onMerged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Review possible duplicate item names"
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {error && (
        <p role="alert" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 10 }}>
          {error}
        </p>
      )}
      {groups === null ? (
        <p className={styles.note}>Checking…</p>
      ) : groups.length === 0 ? (
        <EmptyState>No duplicate-looking names found. Good housekeeping!</EmptyState>
      ) : (
        <>
          <p className={styles.note} style={{ marginBottom: 10 }}>
            Each group below looks like the same item written differently. Choose the name to keep — every sales order,
            quotation and stock record using the other spellings will be renamed to it (quantities and values are
            untouched), and the duplicate sheet entries are merged.
          </p>
          {groups.map((group, gi) => (
            <div key={gi} className={styles.dupGroup}>
              <b>Group {gi + 1}</b>
              <br />
              {group.map((n) => (
                <label key={n} style={{ display: "block", margin: "4px 0" }}>
                  <input
                    type="radio"
                    name={`dup-${gi}`}
                    value={n}
                    checked={keep[gi] === n}
                    onChange={() => setKeep((prev) => ({ ...prev, [gi]: n }))}
                  />{" "}
                  {n}
                </label>
              ))}
              <Button size="sm" variant="primary" style={{ marginTop: 6 }} disabled={busy} onClick={() => merge(gi, group)}>
                Merge into selected name
              </Button>
            </div>
          ))}
        </>
      )}
    </Modal>
  );
}
