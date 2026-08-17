"use client";

import { useState } from "react";
import { Modal } from "../Modal/Modal";
import { Button } from "../Button/Button";
import { FormField, FormRow } from "../Form/FormField";
import { TextInput, Textarea } from "../Form/Inputs";
import { useToast } from "../Toast/ToastProvider";
import { apiFetch, ApiError } from "../../lib/apiClient";

export interface CustomerFormValues {
  id?: string;
  name: string;
  billing: string;
  delivery: string;
  phone: string;
  email: string;
  gstin: string;
  refBy: string;
  salesPerson: string;
  notes: string;
}

export const emptyCustomer: CustomerFormValues = {
  name: "",
  billing: "",
  delivery: "",
  phone: "",
  email: "",
  gstin: "",
  refBy: "",
  salesPerson: "",
  notes: "",
};

// Field-level messages returned by the server's Zod schema, so the user sees
// "Enter a valid GSTIN" on the GSTIN box rather than one generic banner.
type FieldErrors = Partial<Record<keyof CustomerFormValues, string>>;

function issuesToFieldErrors(issues: unknown): FieldErrors {
  const out: FieldErrors = {};
  if (!Array.isArray(issues)) return out;
  for (const issue of issues as { path?: unknown[]; message?: string }[]) {
    const key = issue?.path?.[0];
    if (typeof key === "string" && issue.message) out[key as keyof CustomerFormValues] = issue.message;
  }
  return out;
}

export function CustomerFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: CustomerFormValues;
  onClose: () => void;
  onSaved: (customer: { id: string; name: string; billing: string | null; delivery: string | null; refBy: string | null; salesPerson: string | null }) => void;
}) {
  const editing = !!initial?.id;
  const [values, setValues] = useState<CustomerFormValues>(initial ?? emptyCustomer);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const set = (key: keyof CustomerFormValues) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const save = async () => {
    if (saving) return; // guards against a double click creating two customers
    setSaving(true);
    setFormError("");
    setErrors({});
    try {
      const payload = { ...values };
      delete payload.id;
      const res = await apiFetch<{ customer: { id: string; name: string; billing: string | null; delivery: string | null; refBy: string | null; salesPerson: string | null } }>(
        editing ? `/api/customers/${initial!.id}` : "/api/customers",
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(payload) }
      );
      toast(editing ? "Customer updated" : "Customer created");
      onSaved(res.customer);
    } catch (err) {
      if (err instanceof ApiError) {
        const fieldErrors = issuesToFieldErrors(err.issues);
        setErrors(fieldErrors);
        setFormError(Object.keys(fieldErrors).length ? "Please correct the highlighted fields." : err.message);
      } else {
        setFormError("Could not reach the server. Check your connection and try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  const err = (k: keyof CustomerFormValues) =>
    errors[k] ? <span style={{ color: "var(--danger)", fontSize: 12 }}>{errors[k]}</span> : null;

  return (
    <Modal
      title={editing ? "Edit customer" : "New customer"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save customer"}
          </Button>
        </>
      }
    >
      {formError && (
        <p role="alert" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 10 }}>
          {formError}
        </p>
      )}
      <FormRow>
        <div style={{ gridColumn: "span 2" }}>
          <FormField label="Customer name *">
            <TextInput value={values.name} onChange={set("name")} autoFocus />
          </FormField>
          {err("name")}
        </div>
        <div>
          <FormField label="Phone">
            <TextInput value={values.phone} onChange={set("phone")} inputMode="tel" />
          </FormField>
          {err("phone")}
        </div>
        <div>
          <FormField label="Email">
            <TextInput value={values.email} onChange={set("email")} inputMode="email" />
          </FormField>
          {err("email")}
        </div>
      </FormRow>
      <FormRow>
        <FormField label="Billing address">
          <Textarea rows={3} value={values.billing} onChange={set("billing")} />
        </FormField>
        <div>
          <FormField label="Delivery address">
            <Textarea rows={3} value={values.delivery} onChange={set("delivery")} />
          </FormField>
          <Button
            size="sm"
            type="button"
            onClick={() => setValues((v) => ({ ...v, delivery: v.billing }))}
            style={{ marginTop: -8 }}
          >
            Same as billing
          </Button>
        </div>
      </FormRow>
      <FormRow>
        <div>
          <FormField label="GSTIN">
            <TextInput value={values.gstin} onChange={set("gstin")} style={{ textTransform: "uppercase" }} />
          </FormField>
          {err("gstin")}
        </div>
        <FormField label="Referred by (architect / consultant)">
          <TextInput value={values.refBy} onChange={set("refBy")} />
        </FormField>
        <FormField label="Sales person">
          <TextInput value={values.salesPerson} onChange={set("salesPerson")} />
        </FormField>
      </FormRow>
      <FormField label="Notes">
        <Textarea rows={2} value={values.notes} onChange={set("notes")} />
      </FormField>
    </Modal>
  );
}
