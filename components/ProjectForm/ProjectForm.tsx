"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import {
  APPROVAL_MODES,
  PROJECT_TYPES,
  ProjectInput,
  projectInputSchema,
} from "../../modules/projects/schema";
import { PROJECT_TYPE_LABEL } from "../../modules/projects/data";
import { Card, CardBody, CardHeader } from "../Card/Card";
import { FormField, FormRow } from "../Form/FormField";
import { TextInput, Select, Textarea } from "../Form/Inputs";
import { Segmented } from "../Segmented/Segmented";
import { Button } from "../Button/Button";
import { TableWrap, Table, Th, Td } from "../Table/Table";
import { FileDrop } from "../FileDrop/FileDrop";
import { AttachmentRow } from "../FileDrop/AttachmentRow";
import { AiBadge, Spinner } from "../Status/Status";
import { Chip } from "../Chip/Chip";
import { inr, todayIso } from "../../lib/format";
import { apiFetch } from "../../lib/apiClient";
import { useToast } from "../Toast/ToastProvider";
import { useUploadDocument } from "../../hooks/useUploadDocument";
import { extractedOrderSchema } from "../../modules/import/schema";
import styles from "./ProjectForm.module.css";

const APPROVAL_LABEL: Record<(typeof APPROVAL_MODES)[number], string> = {
  PURCHASE_ORDER: "Purchase Order",
  QUOTE_EMAIL: "Quote — Email",
  QUOTE_WHATSAPP: "Quote — WhatsApp",
  QUOTE_VERBAL: "Quote — Verbal",
};

// Ported from renderNew()'s apHint() — same per-mode hint text as the prototype.
const APPROVAL_HINT: Record<(typeof APPROVAL_MODES)[number], string> = {
  PURCHASE_ORDER: "Attach the purchase order copy below (it is also indexed for search once the project is created).",
  QUOTE_EMAIL: "Attach a copy of the approval email (PDF or screenshot) here:",
  QUOTE_WHATSAPP: "Attach the WhatsApp approval screenshot here:",
  QUOTE_VERBAL: "Verbal approval — note who approved and when:",
};

// Ported from renderNew() — basis of approval (with per-mode approval-copy
// attachment, as in the prototype's apHint()), terms, order-copy dropzone,
// and a manually-editable Sales Order table. Files chosen here are held in
// memory until "Save project" (there is no project id to attach them to
// before that), then uploaded against the newly created project — the same
// hold-until-save behavior the prototype had with its in-memory draft.
// Difference from the prototype, by design (Phase 6 pivot): the attached
// PO/BOQ is stored + text-indexed for search, but no AI reads it into the
// Sales Order — items are entered manually or imported deliberately.
export function ProjectForm({ gstRatePct }: { gstRatePct: number }) {
  const router = useRouter();
  const toast = useToast();
  const upload = useUploadDocument();

  const [orderFile, setOrderFile] = useState<File | null>(null);
  const [approvalFiles, setApprovalFiles] = useState<File[]>([]);
  const [parseState, setParseState] = useState<
    { status: "idle" } | { status: "parsing" } | { status: "done"; itemCount: number } | { status: "failed"; message: string }
  >({ status: "idle" });
  // Totals-block extras read from the document: the discount is auto-created
  // as a special discount on save; a GST rate differing from Settings only
  // warns (the rate is a global setting — a document shouldn't silently
  // change it for every project).
  const [parsedDiscount, setParsedDiscount] = useState<{ amount: number | null; pct: number | null } | null>(null);
  const [parsedGstRate, setParsedGstRate] = useState<number | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ProjectInput>({
    resolver: zodResolver(projectInputSchema),
    defaultValues: {
      name: "",
      client: "",
      site: "",
      type: "SWIMMING_POOL",
      status: "IN_PROGRESS",
      approvalMode: "PURCHASE_ORDER",
      approvalBasisNote: "",
      poNumber: "",
      poDate: todayIso(),
      termsGst: "EXTRA",
      termsTransport: "EXTRA",
      paymentTerms: "",
      items: [],
    },
  });

  const { fields, append, remove, replace } = useFieldArray({ control, name: "items" });
  const approvalMode = watch("approvalMode");
  const items = watch("items");
  const orderBase = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0);

  // Ported from the prototype's handleOrderFile(): on attach, read the
  // document (locally — pdf-parse tables/text + Tesseract for images, no
  // cloud AI), fill header fields only where still empty, and populate the
  // Sales Order items grid. Everything stays editable before saving.
  async function handleOrderFile(file: File) {
    setOrderFile(file);
    setParseState({ status: "parsing" });
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/parse-order", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to read the document");
      const parsed = extractedOrderSchema.parse(data.extracted);

      if (parsed.projectName && !getValues("name")) setValue("name", parsed.projectName);
      if (parsed.clientName && !getValues("client")) setValue("client", parsed.clientName);
      if (parsed.siteAddress && !getValues("site")) setValue("site", parsed.siteAddress);
      if (parsed.poNumber && !getValues("poNumber")) setValue("poNumber", parsed.poNumber);
      if (parsed.poDate) setValue("poDate", parsed.poDate);
      if (parsed.terms.gst === "included") setValue("termsGst", "INCLUDED");
      if (parsed.terms.transport === "included") setValue("termsTransport", "INCLUDED");
      if (parsed.terms.payment && !getValues("paymentTerms")) setValue("paymentTerms", parsed.terms.payment);
      if (parsed.items.length > 0) {
        replace(parsed.items.map((it) => ({ description: it.description, unit: it.unit, qty: it.qty, rate: it.rate })));
      }
      setParsedDiscount(parsed.discountAmount || parsed.discountPct ? { amount: parsed.discountAmount, pct: parsed.discountPct } : null);
      setParsedGstRate(parsed.gstRatePct);
      setParseState({ status: "done", itemCount: parsed.items.length });
    } catch (err) {
      setParseState({ status: "failed", message: err instanceof Error ? err.message : "Failed to read the document" });
    }
  }

  const createMutation = useMutation({
    mutationFn: async (input: ProjectInput) => {
      const data = await apiFetch<{ project: { id: string } }>("/api/projects", {
        method: "POST",
        body: JSON.stringify(input),
      });
      const projectId = data.project.id;

      // Upload held files against the new project. Failures here shouldn't
      // orphan the project — surface them but continue to the detail page,
      // where the Documents tab can retry the upload.
      const failures: string[] = [];
      if (orderFile) {
        try {
          await upload.mutateAsync({ file: orderFile, kind: "ORDER_COPY", projectId, allowDuplicate: true });
        } catch {
          failures.push(orderFile.name);
        }
      }
      for (const f of approvalFiles) {
        try {
          await upload.mutateAsync({ file: f, kind: "APPROVAL_PROOF", projectId, allowDuplicate: true });
        } catch {
          failures.push(f.name);
        }
      }

      // Discount read from the PO's totals block → created as a special
      // discount (same entity the Discounts & Amendments tab manages, and
      // the same place the financial engine already subtracts it — the
      // engine's ordering, base − discount then GST, matches the PO's own
      // totals math). Amount preferred; a %-only discount is computed from
      // the drafted items' basic value.
      if (parsedDiscount) {
        const base = input.items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0);
        const amount = parsedDiscount.amount ?? (parsedDiscount.pct ? Math.round(base * parsedDiscount.pct) / 100 : 0);
        if (amount > 0) {
          try {
            await apiFetch(`/api/projects/${projectId}/discounts`, {
              method: "POST",
              body: JSON.stringify({
                date: input.poDate || todayIso(),
                amount,
                reason: parsedDiscount.pct ? `Discount as per PO (${parsedDiscount.pct}%)` : "Discount as per PO",
              }),
            });
          } catch {
            failures.push("PO discount entry");
          }
        }
      }
      return { projectId, failures };
    },
    onSuccess: ({ projectId, failures }) => {
      toast(
        failures.length === 0
          ? "Project saved"
          : `Project saved, but upload failed for: ${failures.join(", ")} — retry from the Documents tab`
      );
      router.push(`/projects/${projectId}`);
    },
    onError: (err) => toast(err instanceof Error ? err.message : "Failed to save project"),
  });

  const onSubmit = (input: ProjectInput) => createMutation.mutate(input);
  const busy = isSubmitting || createMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <h3>New Project</h3>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit(onSubmit)}>
          <FormRow>
            <FormField label="Project name *">
              <TextInput placeholder="e.g. DLF Camellias — Pool & Spa" {...register("name")} />
              {errors.name && <p className={styles.error}>{errors.name.message}</p>}
            </FormField>
            <FormField label="Client name *">
              <TextInput {...register("client")} />
              {errors.client && <p className={styles.error}>{errors.client.message}</p>}
            </FormField>
            <FormField label="Site / location">
              <TextInput {...register("site")} />
            </FormField>
            <FormField label="Project type">
              <Select {...register("type")}>
                {PROJECT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PROJECT_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </FormField>
          </FormRow>

          <h3 className={styles.sectionTitle}>Basis of approval</h3>
          <Segmented
            options={APPROVAL_MODES.map((m) => ({ value: m, label: APPROVAL_LABEL[m] }))}
            value={approvalMode}
            onChange={(v) => setValue("approvalMode", v)}
          />
          <p className={styles.hint}>{APPROVAL_HINT[approvalMode]}</p>
          {approvalMode === "QUOTE_VERBAL" ? (
            <FormField label="Approved by / note">
              <TextInput placeholder="e.g. Approved by Mr. Sharma on call, 12 Jan" {...register("approvalBasisNote")} />
            </FormField>
          ) : approvalMode !== "PURCHASE_ORDER" ? (
            <div style={{ marginBottom: 14 }}>
              {approvalFiles.map((f, i) => (
                <AttachmentRow
                  key={`${f.name}-${i}`}
                  name={f.name}
                  addedDate={todayIso()}
                  onView={() => window.open(URL.createObjectURL(f), "_blank")}
                  onRemove={() => setApprovalFiles((prev) => prev.filter((_, idx) => idx !== i))}
                />
              ))}
              <FileDrop accept="application/pdf,image/*" onFile={(f) => setApprovalFiles((prev) => [...prev, f])}>
                Attach approval copy (screenshot / PDF)
              </FileDrop>
            </div>
          ) : null}

          <FormRow>
            <FormField label="PO / Reference number">
              <TextInput {...register("poNumber")} />
            </FormField>
            <FormField label="PO / Approval date">
              <TextInput type="date" {...register("poDate")} />
            </FormField>
          </FormRow>

          <h3 className={styles.sectionTitle}>Terms</h3>
          <FormRow>
            <FormField label="GST">
              <Select {...register("termsGst")}>
                <option value="EXTRA">Extra ({gstRatePct}%)</option>
                <option value="INCLUDED">Included in rates</option>
              </Select>
            </FormField>
            <FormField label="Transport">
              <Select {...register("termsTransport")}>
                <option value="EXTRA">Extra at actuals</option>
                <option value="INCLUDED">Included</option>
              </Select>
            </FormField>
            <FormField label="Payment terms">
              <Textarea
                rows={2}
                placeholder="e.g. 50% advance, 40% on delivery, 10% on completion"
                {...register("paymentTerms")}
              />
            </FormField>
          </FormRow>

          <h3 className={styles.sectionTitle}>Order copy (PO / BOQ / approved quotation)</h3>
          <p className={styles.hint}>
            Attach the PDF or image — it is read automatically (locally, no external AI service) and the Sales Order
            is prepared for you. Review and edit everything before saving.
          </p>
          {orderFile ? (
            <div style={{ marginBottom: 14 }}>
              <AttachmentRow
                name={orderFile.name}
                addedDate={todayIso()}
                onView={() => window.open(URL.createObjectURL(orderFile), "_blank")}
                onRemove={() => {
                  setOrderFile(null);
                  setParseState({ status: "idle" });
                }}
              />
            </div>
          ) : (
            <div style={{ marginBottom: 14 }}>
              <FileDrop accept="application/pdf,image/*" onFile={handleOrderFile}>
                Drop the PO / BOQ / quotation here, or click to choose a file
              </FileDrop>
            </div>
          )}
          {parseState.status === "parsing" && (
            <p className={styles.hint}>
              <Spinner />
              <AiBadge>Reading the document and preparing the sales order…</AiBadge>
            </p>
          )}
          {parseState.status === "done" && (
            <p className={styles.hint}>
              <AiBadge>
                Sales order drafted — {parseState.itemCount} item(s) read from the document. Review below and edit if
                needed.
              </AiBadge>{" "}
              {parseState.itemCount === 0 && (
                <Chip tone="gold">No item rows recognized — add them manually below, or check the document layout.</Chip>
              )}{" "}
              {parsedDiscount && (
                <Chip tone="teal">
                  Discount detected{parsedDiscount.pct ? ` (${parsedDiscount.pct}%)` : ""}
                  {parsedDiscount.amount ? ` — ${inr(parsedDiscount.amount)}` : ""} · will be added as a special discount
                </Chip>
              )}{" "}
              {parsedGstRate !== null && parsedGstRate !== gstRatePct && (
                <Chip tone="gold">
                  Document shows GST @ {parsedGstRate}% but the app is set to {gstRatePct}% — update it in Settings if
                  this is the correct rate.
                </Chip>
              )}
            </p>
          )}
          {parseState.status === "failed" && (
            <p className={styles.hint}>
              <Chip tone="red">Auto-read failed</Chip> {parseState.message} — you can still add items manually.
            </p>
          )}

          <h3 className={styles.sectionTitle}>Sales Order items</h3>
          {fields.length > 0 && (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th style={{ width: "44%" }}>Description</Th>
                    <Th>Unit</Th>
                    <Th align="r">Qty</Th>
                    <Th align="r">Rate</Th>
                    <Th align="r">Amount</Th>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f, i) => (
                    <tr key={f.id}>
                      <Td>
                        <TextInput {...register(`items.${i}.description` as const)} />
                      </Td>
                      <Td>
                        <TextInput className={styles.unitCell} {...register(`items.${i}.unit` as const)} />
                      </Td>
                      <Td align="r">
                        <TextInput
                          type="number"
                          step="any"
                          className={styles.qtyCell}
                          {...register(`items.${i}.qty` as const)}
                        />
                      </Td>
                      <Td align="r">
                        <TextInput
                          type="number"
                          step="any"
                          className={styles.rateCell}
                          {...register(`items.${i}.rate` as const)}
                        />
                      </Td>
                      <Td align="r" className="money">
                        {inr((Number(items[i]?.qty) || 0) * (Number(items[i]?.rate) || 0))}
                      </Td>
                      <Td>
                        <Button type="button" size="sm" variant="danger" onClick={() => remove(i)} aria-label="Remove item">
                          <X size={14} />
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <Td colSpan={4} align="r">
                      Basic value
                    </Td>
                    <Td align="r" className="money">
                      {inr(orderBase)}
                    </Td>
                    <Td></Td>
                  </tr>
                </tfoot>
              </Table>
            </TableWrap>
          )}

          <div className={styles.actions}>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Saving…" : "Save project"}
            </Button>
            <Button
              type="button"
              onClick={() => append({ description: "", unit: "Nos", qty: 1, rate: 0 })}
            >
              + Add sales order item manually
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
