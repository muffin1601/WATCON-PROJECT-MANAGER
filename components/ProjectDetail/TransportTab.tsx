"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Card, CardBody, CardHeader } from "../Card/Card";
import { TableWrap, Table, Th, Td, EmptyState } from "../Table/Table";
import { Button } from "../Button/Button";
import { Chip } from "../Chip/Chip";
import { Modal } from "../Modal/Modal";
import { ConfirmModal } from "../Modal/ConfirmModal";
import { FormField, FormRow } from "../Form/FormField";
import { TextInput, Select } from "../Form/Inputs";
import { inr, dfmt, todayIso } from "../../lib/format";
import { apiFetch } from "../../lib/apiClient";
import { useToast } from "../Toast/ToastProvider";
import { useUploadDocument } from "../../hooks/useUploadDocument";
import { TransportInput, transportInputSchema } from "../../modules/projects/schema";
import { MAX_DOCUMENT_UPLOAD_BYTES, formatUploadLimit } from "../../modules/documents/uploadLimits";
import { pickUploadFile } from "../FileDrop/pickUploadFile";
import type { ProjectViewModel } from "../../modules/projects/viewModel";

type Transport = ProjectViewModel["transports"][number];

// Ported from tabTransport(p, el) / transportModal(p, editing) — transport
// bills list with extra/included badge, add/edit modal (incl. bill copy
// upload and "against challan" link) and delete confirmation.
export function TransportTab({ project }: { project: ProjectViewModel }) {
  const router = useRouter();
  const toast = useToast();
  const uploadDoc = useUploadDocument();
  const [editing, setEditing] = useState<Transport | null>(null);
  const [open, setOpen] = useState(false);
  const [billFile, setBillFile] = useState<File | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const extra = project.termsTransport === "EXTRA";

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TransportInput>({
    resolver: zodResolver(transportInputSchema),
    defaultValues: { date: todayIso(), amount: 0, transporter: "", ref: "", vehicle: "", challanId: "" },
  });

  function openModal(t: Transport | null) {
    setEditing(t);
    setBillFile(null);
    reset({
      date: t?.date ?? todayIso(),
      amount: t?.amount ?? 0,
      transporter: t?.transporter ?? "",
      ref: t?.ref ?? "",
      vehicle: t?.vehicle ?? "",
      challanId: t?.challanId ?? "",
    });
    setOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (input: TransportInput) => {
      const payload = { ...input, challanId: input.challanId || null };
      let transportId: string;
      if (editing) {
        await apiFetch(`/api/transports/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) });
        transportId = editing.id;
      } else {
        const res = await apiFetch<{ transport: { id: string } }>(`/api/projects/${project.id}/transports`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        transportId = res.transport.id;
      }
      if (billFile) {
        await uploadDoc.mutateAsync({ file: billFile, kind: "TRANSPORT_BILL", projectId: project.id, transportId });
      }
    },
    onSuccess: () => {
      router.refresh();
      setOpen(false);
      toast(editing ? "Transport bill updated" : "Transport bill added");
    },
    onError: (e: Error) => toast(e.message || "Failed to save transport bill"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/transports/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      router.refresh();
      setConfirmDeleteId(null);
    },
    onError: () => toast("Failed to delete transport bill"),
  });

  const challanNoById = new Map(project.challans.map((c) => [c.id, c.no]));

  return (
    <Card>
      <CardHeader>
        <h3>Transport bills</h3>
        <Chip tone={extra ? "teal" : "grey"} title="Set in Sales Order / Edit terms">
          {extra ? "Extra — billed to client at actuals on running bills" : "Included in rates — internal cost, not billed to client"}
        </Chip>
        <Button size="sm" variant="primary" style={{ marginLeft: "auto" }} onClick={() => openModal(null)}>
          + Add transport bill
        </Button>
      </CardHeader>
      <CardBody>
        {project.transports.length === 0 ? (
          <EmptyState>No transport bills yet. Add them here, or attach one while issuing a challan.</EmptyState>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Transporter</Th>
                  <Th>Bill / LR no.</Th>
                  <Th>Vehicle</Th>
                  <Th>Against challan</Th>
                  <Th align="r">Amount</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {project.transports.map((t) => (
                  <tr key={t.id}>
                    <Td style={{ whiteSpace: "nowrap" }}>{dfmt(t.date)}</Td>
                    <Td>{t.transporter || "—"}</Td>
                    <Td>{t.ref || "—"}</Td>
                    <Td>{t.vehicle || "—"}</Td>
                    <Td>{t.challanId ? <span className="mono">{challanNoById.get(t.challanId) ?? "—"}</span> : "—"}</Td>
                    <Td align="r" className="money">
                      {inr(t.amount)}
                    </Td>
                    <Td style={{ whiteSpace: "nowrap" }}>
                      {t.attachments[0] && (
                        <>
                          <Button size="sm" onClick={() => window.open(t.attachments[0]!.url, "_blank")}>
                            Bill
                          </Button>{" "}
                        </>
                      )}
                      <Button size="sm" onClick={() => openModal(t)}>
                        Edit
                      </Button>{" "}
                      <Button size="sm" variant="danger" aria-label="Delete transport bill" onClick={() => setConfirmDeleteId(t.id)}>
                        ×
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <Td colSpan={5} align="r">
                    Total transport{extra ? " (recoverable from client)" : ""}
                  </Td>
                  <Td align="r" className="money">
                    {inr(project.financials.transportTotal)}
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
          title={editing ? "Edit transport bill" : "Add transport bill"}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={handleSubmit((v) => saveMutation.mutate(v))}
                disabled={saveMutation.isPending || uploadDoc.isPending}
              >
                {editing ? "Save changes" : "Add transport bill"}
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
            <FormField label="Transporter">
              <TextInput {...register("transporter")} />
            </FormField>
            <FormField label="Bill / LR number">
              <TextInput {...register("ref")} />
            </FormField>
            <FormField label="Vehicle">
              <TextInput {...register("vehicle")} />
            </FormField>
            <FormField label="Against challan (optional)">
              <Select {...register("challanId")}>
                <option value="">—</option>
                {project.challans.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.no} — {dfmt(c.date)}
                  </option>
                ))}
              </Select>
            </FormField>
          </FormRow>
          <FormField label="Transport bill copy (PDF or image)">
            <input type="file" accept="application/pdf,image/*" onChange={(e) => pickUploadFile(e.target.files?.[0], setBillFile, toast)} />
            <p className="note">Maximum file size: below {formatUploadLimit(MAX_DOCUMENT_UPLOAD_BYTES)}</p>
          </FormField>
          {editing?.attachments[0] && (
            <p className="note" style={{ marginTop: -8 }}>
              Current attachment: {editing.attachments[0].fileName} (choose a new file to replace)
            </p>
          )}
        </Modal>
      )}

      {confirmDeleteId && (
        <ConfirmModal
          message="Delete this transport bill?"
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={() => deleteMutation.mutate(confirmDeleteId)}
        />
      )}
    </Card>
  );
}
