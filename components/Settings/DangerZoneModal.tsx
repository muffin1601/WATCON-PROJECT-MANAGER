"use client";

import { useState } from "react";
import { Modal } from "../Modal/Modal";
import { Button } from "../Button/Button";
import { FormField } from "../Form/FormField";
import { TextInput } from "../Form/Inputs";
import { useToast } from "../Toast/ToastProvider";
import { apiFetch, ApiError } from "../../lib/apiClient";
import styles from "./SettingsForm.module.css";

// Ported from the prototype's "Clear all data…" flow: password, then an
// explicit confirmation with a tick box and an offer to back up first. Used for
// Import backup too, since that also replaces live data.
export function DangerZoneModal({
  mode,
  backup,
  onClose,
  onDone,
  onExport,
}: {
  mode: "clear" | "import";
  /** Parsed backup file, for mode "import". */
  backup?: unknown;
  onClose: () => void;
  onDone: () => void;
  onExport: () => void;
}) {
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (busy) return;
    if (!understood) {
      setError("Tick the confirmation box first");
      return;
    }
    if (!password) {
      setError("Enter the deletion password");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch<{ counts?: Record<string, number>; projects?: number }>("/api/settings/data", {
        method: "POST",
        body: JSON.stringify(mode === "clear" ? { action: "clear", password } : { action: "import", password, backup }),
      });
      toast(
        mode === "clear"
          ? `All data cleared (${res.counts?.projects ?? 0} project(s) removed)`
          : `Backup restored — ${res.projects ?? 0} project(s)`
      );
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server — nothing was changed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={mode === "clear" ? "Clear all data" : "Import backup"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onExport}>
            Export backup first
          </Button>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            style={{ background: "var(--danger)", color: "#fff", borderColor: "var(--danger)" }}
            onClick={run}
            disabled={busy}
          >
            {busy ? "Working…" : mode === "clear" ? "Delete everything" : "Replace all data"}
          </Button>
        </>
      }
    >
      {mode === "clear" ? (
        <p style={{ marginBottom: 10 }}>
          This will permanently delete <b>all projects, customers, quotations, purchase records, the item sheet, the
          item master and stock records</b>. Company details, numbering, the API key and <b>user accounts</b> are kept.
        </p>
      ) : (
        <p style={{ marginBottom: 10 }}>
          This will <b>replace all current data</b> with the contents of the backup file. User accounts and stored
          passwords on this deployment are kept.
        </p>
      )}
      <p className={styles.note} style={{ marginBottom: 12 }}>
        Take a backup first if there is any chance you will need this data again.
      </p>

      <FormField label="Deletion password">
        <TextInput
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
      </FormField>

      <label style={{ display: "block", marginBottom: 6 }}>
        <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} /> I understand
        this cannot be undone
      </label>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </Modal>
  );
}
