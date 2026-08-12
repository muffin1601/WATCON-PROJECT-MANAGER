"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Card, CardBody, CardHeader } from "../Card/Card";
import { Button } from "../Button/Button";
import { Modal } from "../Modal/Modal";
import { ConfirmModal } from "../Modal/ConfirmModal";
import { FormField } from "../Form/FormField";
import { TextInput } from "../Form/Inputs";
import { EmptyState } from "../Table/Table";
import { inr, dfmt, todayIso } from "../../lib/format";
import { apiFetch } from "../../lib/apiClient";
import { useToast } from "../Toast/ToastProvider";
import { useUploadDocument } from "../../hooks/useUploadDocument";
import { DiscountInput, AmendmentInput } from "../../modules/adjustments/schema";
import { MAX_DOCUMENT_UPLOAD_BYTES, formatUploadLimit } from "../../modules/documents/uploadLimits";
import { pickUploadFile } from "../FileDrop/pickUploadFile";
import type { ProjectViewModel } from "../../modules/projects/viewModel";
import styles from "./DiscountsAmendmentsTab.module.css";

// Ported from tabAdjust(p, el) — "Special discounts" and "Amendments" cards
// side by side.
export function DiscountsAmendmentsTab({ project }: { project: ProjectViewModel }) {
  const router = useRouter();
  const toast = useToast();
  const uploadDoc = useUploadDocument();

  const [discountOpen, setDiscountOpen] = useState(false);
  const [discDate, setDiscDate] = useState(todayIso());
  const [discAmount, setDiscAmount] = useState(0);
  const [discReason, setDiscReason] = useState("");
  const [confirmDeleteDiscount, setConfirmDeleteDiscount] = useState<string | null>(null);

  const [amendOpen, setAmendOpen] = useState(false);
  const [amDate, setAmDate] = useState(todayIso());
  const [amDesc, setAmDesc] = useState("");
  const [amValue, setAmValue] = useState(0);
  const [amFile, setAmFile] = useState<File | null>(null);
  const [confirmDeleteAmendment, setConfirmDeleteAmendment] = useState<string | null>(null);

  const addDiscount = useMutation({
    mutationFn: () => {
      const input: DiscountInput = { date: discDate, amount: discAmount, reason: discReason };
      return apiFetch(`/api/projects/${project.id}/discounts`, { method: "POST", body: JSON.stringify(input) });
    },
    onSuccess: () => {
      router.refresh();
      setDiscountOpen(false);
      setDiscAmount(0);
      setDiscReason("");
    },
    onError: (err) => toast(err instanceof Error ? err.message : "Failed to apply discount"),
  });

  const deleteDiscount = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/discounts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      router.refresh();
      setConfirmDeleteDiscount(null);
    },
    onError: () => toast("Failed to remove discount"),
  });

  const addAmendment = useMutation({
    mutationFn: async () => {
      const input: AmendmentInput = { date: amDate, description: amDesc, valueChange: amValue };
      const res = await apiFetch<{ amendment: { id: string } }>(`/api/projects/${project.id}/amendments`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (amFile) {
        await uploadDoc.mutateAsync({
          file: amFile,
          kind: "AMENDMENT_APPROVAL",
          projectId: project.id,
          amendmentId: res.amendment.id,
        });
      }
      return res;
    },
    onSuccess: () => {
      router.refresh();
      setAmendOpen(false);
      setAmDesc("");
      setAmValue(0);
      setAmFile(null);
    },
    onError: (err) => toast(err instanceof Error ? err.message : "Failed to save amendment"),
  });

  const deleteAmendment = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/amendments/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      router.refresh();
      setConfirmDeleteAmendment(null);
    },
    onError: () => toast("Failed to remove amendment"),
  });

  return (
    <div className={styles.grid}>
      <Card>
        <CardHeader>
          <h3>Special discounts</h3>
          <Button size="sm" variant="primary" style={{ marginLeft: "auto" }} onClick={() => setDiscountOpen(true)}>
            + Give discount
          </Button>
        </CardHeader>
        <CardBody>
          {project.discounts.length === 0 ? (
            <EmptyState>No special discounts given.</EmptyState>
          ) : (
            project.discounts.map((d) => (
              <div key={d.id} className={styles.row}>
                <span className={styles.nm}>{d.reason || "Special discount"}</span>
                <span className={styles.mt}>{dfmt(d.date)}</span>
                <span className="money" style={{ color: "var(--danger)" }}>
                  − {inr(d.amount)}
                </span>
                <Button size="sm" variant="danger" aria-label="Remove discount" onClick={() => setConfirmDeleteDiscount(d.id)}>
                  <X size={14} />
                </Button>
              </div>
            ))
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h3>Amendments</h3>
          <Button size="sm" variant="primary" style={{ marginLeft: "auto" }} onClick={() => setAmendOpen(true)}>
            + Add amendment
          </Button>
        </CardHeader>
        <CardBody>
          {project.amendments.length === 0 ? (
            <EmptyState>No amendments. Use this when the client changes scope — attach the approved amendment copy.</EmptyState>
          ) : (
            project.amendments.map((a) => (
              <div key={a.id} className={styles.row}>
                <span className={styles.nm}>{a.description}</span>
                <span className={styles.mt}>{dfmt(a.date)}</span>
                <span className="money" style={{ color: a.valueChange < 0 ? "var(--danger)" : "var(--ok)" }}>
                  {a.valueChange < 0 ? "−" : "+"} {inr(Math.abs(a.valueChange))}
                </span>
                {a.attachments[0] && (
                  <Button size="sm" onClick={() => window.open(a.attachments[0]!.url, "_blank")}>
                    View
                  </Button>
                )}
                <Button size="sm" variant="danger" aria-label="Remove amendment" onClick={() => setConfirmDeleteAmendment(a.id)}>
                  <X size={14} />
                </Button>
              </div>
            ))
          )}
        </CardBody>
      </Card>

      {discountOpen && (
        <Modal
          title="Give special discount"
          onClose={() => setDiscountOpen(false)}
          footer={
            <>
              <Button onClick={() => setDiscountOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => addDiscount.mutate()} disabled={addDiscount.isPending}>
                Apply discount
              </Button>
            </>
          }
        >
          <FormField label="Date">
            <TextInput type="date" value={discDate} onChange={(e) => setDiscDate(e.target.value)} />
          </FormField>
          <FormField label="Discount amount (₹, on basic value) *">
            <TextInput type="number" min={0} value={discAmount} onChange={(e) => setDiscAmount(Number(e.target.value) || 0)} />
          </FormField>
          <FormField label="Reason / approved by">
            <TextInput
              placeholder="e.g. Goodwill discount approved by Adit"
              value={discReason}
              onChange={(e) => setDiscReason(e.target.value)}
            />
          </FormField>
        </Modal>
      )}

      {amendOpen && (
        <Modal
          title="Add amendment"
          onClose={() => setAmendOpen(false)}
          footer={
            <>
              <Button onClick={() => setAmendOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => addAmendment.mutate()}
                disabled={addAmendment.isPending || uploadDoc.isPending}
              >
                Save amendment
              </Button>
            </>
          }
        >
          <FormField label="Date">
            <TextInput type="date" value={amDate} onChange={(e) => setAmDate(e.target.value)} />
          </FormField>
          <FormField label="Value change (₹, use minus for reduction) *">
            <TextInput type="number" value={amValue} onChange={(e) => setAmValue(Number(e.target.value) || 0)} />
          </FormField>
          <FormField label="Description *">
            <TextInput
              placeholder="e.g. Additional heat pump added to scope"
              value={amDesc}
              onChange={(e) => setAmDesc(e.target.value)}
            />
          </FormField>
          <FormField label="Approval copy (PO amendment / email / WhatsApp)">
            <input type="file" accept="application/pdf,image/*" onChange={(e) => pickUploadFile(e.target.files?.[0], setAmFile, toast)} />
            <p className="note">Maximum file size: below {formatUploadLimit(MAX_DOCUMENT_UPLOAD_BYTES)}</p>
          </FormField>
        </Modal>
      )}

      {confirmDeleteDiscount && (
        <ConfirmModal
          message="Remove this discount?"
          onCancel={() => setConfirmDeleteDiscount(null)}
          onConfirm={() => deleteDiscount.mutate(confirmDeleteDiscount)}
        />
      )}
      {confirmDeleteAmendment && (
        <ConfirmModal
          message="Remove this amendment?"
          onCancel={() => setConfirmDeleteAmendment(null)}
          onConfirm={() => deleteAmendment.mutate(confirmDeleteAmendment)}
        />
      )}
    </div>
  );
}
