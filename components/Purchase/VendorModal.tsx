"use client";

import { useState } from "react";
import { Modal } from "../Modal/Modal";
import { Button } from "../Button/Button";
import { FormField, FormRow } from "../Form/FormField";
import { TextInput, Textarea } from "../Form/Inputs";
import { useToast } from "../Toast/ToastProvider";
import { apiFetch, ApiError } from "../../lib/apiClient";
import type { VendorDto } from "../../services/vendorService";

// Ported from vendorFormModal(editing, onSave) — the same six fields.
export function VendorModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: VendorDto | null;
  onClose: () => void;
  onSaved: (vendor: VendorDto) => void;
}) {
  const editing = !!initial;
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? "");
  const [contact, setContact] = useState(initial?.contact ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [gstin, setGstin] = useState(initial?.gstin ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    if (!name.trim()) {
      setError("Supplier name is required");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch<{ vendor: VendorDto }>(
        editing ? `/api/vendors/${initial!.id}` : "/api/vendors",
        { method: editing ? "PATCH" : "POST", body: JSON.stringify({ name, contact, phone, email, gstin, address }) }
      );
      toast("Supplier saved");
      onSaved(res.vendor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? "Edit supplier" : "New supplier"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save supplier"}
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
          <FormField label="Supplier / company name *">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </FormField>
        </div>
        <FormField label="Contact person">
          <TextInput value={contact} onChange={(e) => setContact(e.target.value)} />
        </FormField>
        <FormField label="Phone / WhatsApp">
          <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} />
        </FormField>
        <FormField label="Email">
          <TextInput value={email} onChange={(e) => setEmail(e.target.value)} />
        </FormField>
        <FormField label="GSTIN">
          <TextInput value={gstin} onChange={(e) => setGstin(e.target.value)} style={{ textTransform: "uppercase" }} />
        </FormField>
      </FormRow>
      <FormField label="Address">
        <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
      </FormField>
    </Modal>
  );
}
