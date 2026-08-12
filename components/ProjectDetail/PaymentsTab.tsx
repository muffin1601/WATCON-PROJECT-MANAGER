"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Card, CardBody, CardHeader } from "../Card/Card";
import { TableWrap, Table, Th, Td, EmptyState } from "../Table/Table";
import { Button } from "../Button/Button";
import { Modal } from "../Modal/Modal";
import { ConfirmModal } from "../Modal/ConfirmModal";
import { FormField, FormRow } from "../Form/FormField";
import { TextInput, Select } from "../Form/Inputs";
import { inr, dfmt, todayIso } from "../../lib/format";
import { apiFetch } from "../../lib/apiClient";
import { useToast } from "../Toast/ToastProvider";
import { useUploadDocument } from "../../hooks/useUploadDocument";
import { PaymentInput, paymentInputSchema } from "../../modules/projects/schema";
import { MAX_DOCUMENT_UPLOAD_BYTES, formatUploadLimit } from "../../modules/documents/uploadLimits";
import { pickUploadFile } from "../FileDrop/pickUploadFile";
import type { ProjectViewModel } from "../../modules/projects/viewModel";

const MODE_LABEL: Record<string, string> = {
  BANK_TRANSFER: "Bank transfer / NEFT / RTGS",
  CHEQUE: "Cheque",
  UPI: "UPI",
  CASH: "Cash",
  ADJUSTMENT: "Adjustment",
};

// Ported from tabPayments(p, el) — record payment modal (incl. proof of
// payment upload) + payments table.
export function PaymentsTab({ project }: { project: ProjectViewModel }) {
  const router = useRouter();
  const toast = useToast();
  const uploadDoc = useUploadDocument();
  const [open, setOpen] = useState(false);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PaymentInput>({
    resolver: zodResolver(paymentInputSchema),
    defaultValues: { date: todayIso(), amount: 0, mode: "BANK_TRANSFER", reference: "" },
  });

  const addMutation = useMutation({
    mutationFn: async (input: PaymentInput) => {
      const res = await apiFetch<{ payment: { id: string } }>(`/api/projects/${project.id}/payments`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (proofFile) {
        await uploadDoc.mutateAsync({ file: proofFile, kind: "PAYMENT_PROOF", projectId: project.id, paymentId: res.payment.id });
      }
      return res;
    },
    onSuccess: () => {
      router.refresh();
      setOpen(false);
      setProofFile(null);
      reset({ date: todayIso(), amount: 0, mode: "BANK_TRANSFER", reference: "" });
    },
    onError: () => toast("Failed to save payment"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/payments/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      router.refresh();
      setConfirmDeleteId(null);
    },
    onError: () => toast("Failed to delete payment"),
  });

  return (
    <Card>
      <CardHeader>
        <h3>Payments received</h3>
        <Button size="sm" variant="primary" style={{ marginLeft: "auto" }} onClick={() => setOpen(true)}>
          + Record payment
        </Button>
      </CardHeader>
      <CardBody>
        {project.payments.length === 0 ? (
          <EmptyState>No payments recorded yet.</EmptyState>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Mode</Th>
                  <Th>Reference</Th>
                  <Th align="r">Amount</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {project.payments.map((x) => (
                  <tr key={x.id}>
                    <Td style={{ whiteSpace: "nowrap" }}>{dfmt(x.date)}</Td>
                    <Td>{MODE_LABEL[x.mode] ?? x.mode}</Td>
                    <Td>{x.reference || "—"}</Td>
                    <Td align="r" className="money" style={{ color: "var(--ok)" }}>
                      {inr(x.amount)}
                    </Td>
                    <Td style={{ whiteSpace: "nowrap" }}>
                      {x.attachments[0] && (
                        <>
                          <Button size="sm" onClick={() => window.open(x.attachments[0]!.url, "_blank")}>
                            Proof
                          </Button>{" "}
                        </>
                      )}
                      <Button size="sm" variant="danger" aria-label={`Delete payment of ${inr(x.amount)}`} onClick={() => setConfirmDeleteId(x.id)}>
                        ×
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <Td colSpan={3} align="r">
                    Total received
                  </Td>
                  <Td align="r" className="money" style={{ color: "var(--ok)" }}>
                    {inr(project.financials.paidTotal)}
                  </Td>
                  <Td></Td>
                </tr>
              </tfoot>
            </Table>
          </TableWrap>
        )}
      </CardBody>

      {open && (
        <Modal
          title="Record payment"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={handleSubmit((v) => addMutation.mutate(v))}
                disabled={addMutation.isPending || uploadDoc.isPending}
              >
                Save payment
              </Button>
            </>
          }
        >
          <FormRow>
            <FormField label="Date">
              <TextInput type="date" {...register("date")} />
            </FormField>
            <FormField label="Amount (₹) *">
              <TextInput type="number" step="any" {...register("amount")} />
              {errors.amount && <p style={{ color: "var(--danger)", fontSize: 12 }}>{errors.amount.message}</p>}
            </FormField>
            <FormField label="Mode">
              <Select {...register("mode")}>
                {Object.entries(MODE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
          </FormRow>
          <FormField label="Reference (UTR / cheque no. / note)">
            <TextInput {...register("reference")} />
          </FormField>
          <FormField label="Proof of payment (optional — bank advice / cheque copy / screenshot)">
            <input
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => pickUploadFile(e.target.files?.[0], setProofFile, toast)}
            />
            <p className="note">Maximum file size: below {formatUploadLimit(MAX_DOCUMENT_UPLOAD_BYTES)}</p>
          </FormField>
        </Modal>
      )}

      {confirmDeleteId && (
        <ConfirmModal
          message="Delete this payment entry?"
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={() => deleteMutation.mutate(confirmDeleteId)}
        />
      )}
    </Card>
  );
}
