"use client";

import { useRef, useState } from "react";
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
import { DangerZoneModal } from "./DangerZoneModal";
import styles from "./SettingsForm.module.css";

// Ported from renderSettings() — company profile, GST rate, challan/bill/
// quotation numbering, the Anthropic API key, and the data actions: Export
// backup, Import backup and Clear all data.
//
// The API key differs from the prototype in one deliberate way: it is
// write-only. The prototype kept it in localStorage where any visitor could
// read it; here it is stored server-side, never sent back to the browser, and
// the field always renders blank.
// `hasApiKey` is a boolean only — whether a key exists, never the key itself.
export function SettingsForm({ initial }: { initial: SettingsInput & { hasApiKey: boolean } }) {
  const router = useRouter();
  const toast = useToast();
  const [danger, setDanger] = useState<null | { mode: "clear" | "import"; backup?: unknown }>(null);
  const importRef = useRef<HTMLInputElement>(null);

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
            <FormField label="Quotation number prefix">
              <TextInput {...register("quotePrefix")} />
            </FormField>
            <FormField label="Next quotation number">
              <TextInput type="number" {...register("quoteNext")} />
              {errors.quoteNext && <p className={styles.error}>{errors.quoteNext.message}</p>}
            </FormField>
            <FormField label="Edit/delete password (challans)">
              <TextInput {...register("appPassword")} />
              {errors.appPassword && <p className={styles.error}>{errors.appPassword.message}</p>}
            </FormField>
            {/* Write-only, like the deletion password below: the stored key is
                never sent to the browser, so this always renders blank. */}
            <FormField label="Anthropic API key (leave blank to keep current)">
              <TextInput
                type="password"
                autoComplete="off"
                placeholder={initial.hasApiKey ? "•••••••• (a key is saved)" : "sk-ant-…"}
                {...register("anthropicApiKey")}
              />
              {errors.anthropicApiKey && <p className={styles.error}>{errors.anthropicApiKey.message}</p>}
            </FormField>
            {/* Write-only: stored as a hash, so there is nothing to show here.
                Left blank, the current password is kept unchanged. */}
            <FormField label="Full-project deletion password (leave blank to keep current)">
              <TextInput type="password" autoComplete="new-password" {...register("deletePassword")} />
              {errors.deletePassword && <p className={styles.error}>{errors.deletePassword.message}</p>}
            </FormField>
          </FormRow>
          <div className={styles.actions}>
            <Button type="submit" variant="primary" disabled={saveMutation.isPending}>
              Save settings
            </Button>
            <Button type="button" onClick={exportBackup}>
              Export data backup (JSON)
            </Button>
            <Button type="button" onClick={() => importRef.current?.click()}>
              Import backup
            </Button>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  const parsed = JSON.parse(await file.text());
                  if (!parsed || !Array.isArray(parsed.projects)) {
                    toast("That file is not a Watcon backup (it has no projects list).");
                    return;
                  }
                  setDanger({ mode: "import", backup: parsed });
                } catch {
                  toast("Could not read that file — it is not valid JSON.");
                }
              }}
            />
            <Button
              type="button"
              variant="danger"
              style={{ marginLeft: "auto" }}
              onClick={() => setDanger({ mode: "clear" })}
            >
              Clear all data…
            </Button>
          </div>
          <p className={styles.note}>
            Data is stored in Supabase Postgres and Storage. Take a JSON backup regularly — attachment metadata is
            included in the backup, but the stored files themselves are not, so a full restore also needs Supabase&apos;s
            own storage backup. Importing a backup and clearing all data both replace live data and require the
            deletion password.
          </p>
        </form>
      </CardBody>

      {danger && (
        <DangerZoneModal
          mode={danger.mode}
          backup={danger.backup}
          onClose={() => setDanger(null)}
          onExport={exportBackup}
          onDone={() => {
            setDanger(null);
            router.refresh();
          }}
        />
      )}
    </Card>
  );
}
