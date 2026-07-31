"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Card, CardBody, CardHeader } from "../Card/Card";
import { FormField, FormRow } from "../Form/FormField";
import { TextInput } from "../Form/Inputs";
import { Button } from "../Button/Button";
import { apiFetch } from "../../lib/apiClient";
import { useToast } from "../Toast/ToastProvider";
import { SettingsInput, settingsInputSchema } from "../../modules/settings/schema";
import styles from "./SettingsForm.module.css";

// Ported from renderSettings() — company profile, GST rate, challan/bill
// numbering. The prototype's "Anthropic API key" field is intentionally
// absent here: OCR is a server-side provider now, not a browser-side key
// (see KNOWN_LIMITATIONS.md). "Export data backup" is kept (safe, read-only);
// "Import backup" is intentionally not implemented (see services/settingsService.ts).
export function SettingsForm({ initial }: { initial: SettingsInput }) {
  const router = useRouter();
  const toast = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SettingsInput>({ resolver: zodResolver(settingsInputSchema), defaultValues: initial });

  const saveMutation = useMutation({
    mutationFn: (input: SettingsInput) => apiFetch("/api/settings", { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => {
      toast("Settings saved");
      router.refresh();
    },
    onError: (err) => toast(err instanceof Error ? err.message : "Failed to save settings"),
  });

  const exportBackup = async () => {
    const res = await fetch("/api/settings/export");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `watcon-pm-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className={styles.card}>
      <CardHeader>
        <h3>Settings</h3>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit((v) => saveMutation.mutate(v))}>
          <FormRow>
            <FormField label="Company name (on challans & bills)">
              <TextInput {...register("companyName")} />
            </FormField>
            <FormField label="Address">
              <TextInput {...register("address")} />
            </FormField>
            <FormField label="Phone">
              <TextInput {...register("phone")} />
            </FormField>
            <FormField label="Email">
              <TextInput {...register("email")} />
            </FormField>
            <FormField label="GSTIN">
              <TextInput {...register("gstin")} />
            </FormField>
            <FormField label="GST rate %">
              <TextInput type="number" step="any" {...register("gstRatePct")} />
              {errors.gstRatePct && <p className={styles.error}>{errors.gstRatePct.message}</p>}
            </FormField>
            <FormField label="Challan number prefix">
              <TextInput {...register("challanPrefix")} />
            </FormField>
            <FormField label="Next challan number">
              <TextInput type="number" {...register("challanNext")} />
            </FormField>
            <FormField label="Bill number prefix">
              <TextInput {...register("billPrefix")} />
            </FormField>
            <FormField label="Edit/delete password (challans)">
              <TextInput {...register("appPassword")} />
              {errors.appPassword && <p className={styles.error}>{errors.appPassword.message}</p>}
            </FormField>
          </FormRow>
          <div className={styles.actions}>
            <Button type="submit" variant="primary" disabled={saveMutation.isPending}>
              Save settings
            </Button>
            <Button type="button" onClick={exportBackup}>
              Export data backup (JSON)
            </Button>
          </div>
          <p className={styles.note}>
            Data is stored in Supabase Postgres and Storage. Take a JSON backup regularly — attachment metadata is
            included, but re-importing a backup is intentionally not supported (a bulk overwrite of a live production
            database needs a deliberate, reviewed operation, not a button).
          </p>
        </form>
      </CardBody>
    </Card>
  );
}
