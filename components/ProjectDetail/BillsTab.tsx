"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import { Card, CardBody, CardHeader } from "../Card/Card";
import { TableWrap, Table, Th, Td, EmptyState } from "../Table/Table";
import { Button } from "../Button/Button";
import { Modal } from "../Modal/Modal";
import { ConfirmModal } from "../Modal/ConfirmModal";
import { FormField } from "../Form/FormField";
import { TextInput, Select } from "../Form/Inputs";
import { BillDoc } from "../PrintDoc/BillDoc";
import { BillViewModal } from "./BillViewModal";
import { inr, dfmt, todayIso } from "../../lib/format";
import { apiFetch } from "../../lib/apiClient";
import { useToast } from "../Toast/ToastProvider";
import { usePrintPortal } from "../../hooks/usePrintPortal";
import { GenerateBillInput } from "../../modules/challans/schema";
import type { CompanySettings } from "../PrintDoc/DocHead";
import type { ProjectViewModel } from "../../modules/projects/viewModel";

// Ported from tabBills(p, el) + generateBill(p) modal.
export function BillsTab({
  project,
  settings,
  gstRatePct,
}: {
  project: ProjectViewModel;
  settings: CompanySettings;
  gstRatePct: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [genOpen, setGenOpen] = useState(false);
  const [uptoDate, setUptoDate] = useState(todayIso());
  const [applyDiscount, setApplyDiscount] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const { target: printTarget, printArea, print } = usePrintPortal<ProjectViewModel["bills"][number]>();
  const viewingBill = viewingId ? project.bills.find((b) => b.id === viewingId) : undefined;

  const generateMutation = useMutation({
    mutationFn: () => {
      const input: GenerateBillInput = { uptoDate, applyDiscount };
      return apiFetch<{ bill: { id: string } }>(`/api/projects/${project.id}/bills`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    onSuccess: () => {
      router.refresh();
      setGenOpen(false);
      toast("Running bill generated — open it from the list to print.");
    },
    onError: (err) => toast(err instanceof Error ? err.message : "Failed to generate bill"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/bills/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      router.refresh();
      setConfirmDeleteId(null);
    },
    onError: () => toast("Failed to delete bill"),
  });

  return (
    <Card>
      <CardHeader>
        <h3>Running Bills (RA Bills)</h3>
        <Button size="sm" variant="primary" style={{ marginLeft: "auto" }} onClick={() => setGenOpen(true)}>
          + Generate running bill
        </Button>
      </CardHeader>
      <CardBody>
        <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>
          Running bills are prepared automatically from the challans issued up to the bill date: cumulative dispatched
          quantity × sales order rate, plus attached Zoho challan values, less amounts already billed, discounts
          adjusted, GST as per terms.
        </p>
        {project.bills.length === 0 ? (
          <EmptyState>No running bills yet.</EmptyState>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Bill No.</Th>
                  <Th>Date</Th>
                  <Th align="r">Gross to date</Th>
                  <Th align="r">of which extras (beyond SO)</Th>
                  <Th align="r">Less prior billed</Th>
                  <Th align="r">This bill (net)</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {project.bills.map((b) => (
                  <tr key={b.id}>
                    <Td className="mono">
                      <b>{b.no}</b>
                    </Td>
                    <Td style={{ whiteSpace: "nowrap" }}>{dfmt(b.date)}</Td>
                    <Td align="r" className="money">{inr(b.grossToDate)}</Td>
                    <Td align="r" className="money">{b.extraTotal ? inr(b.extraTotal) : "—"}</Td>
                    <Td align="r" className="money">{inr(b.priorBilled)}</Td>
                    <Td align="r" className="money">
                      <b>{inr(b.netPayable)}</b>
                    </Td>
                    <Td style={{ whiteSpace: "nowrap" }}>
                      <Button size="sm" onClick={() => setViewingId(b.id)}>
                        View
                      </Button>{" "}
                      <Button size="sm" onClick={() => print(b)}>
                        Print
                      </Button>{" "}
                      <Button size="sm" variant="danger" aria-label={`Delete bill ${b.no}`} onClick={() => setConfirmDeleteId(b.id)}>
                        ×
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <Td colSpan={5} align="r">
                    Total billed
                  </Td>
                  <Td align="r" className="money">
                    {inr(project.financials.billedTotal)}
                  </Td>
                  <Td></Td>
                </tr>
              </tfoot>
            </Table>
          </TableWrap>
        )}
      </CardBody>

      {genOpen && (
        <Modal
          title="Generate running bill"
          onClose={() => setGenOpen(false)}
          footer={
            <>
              <Button onClick={() => setGenOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
                Generate
              </Button>
            </>
          }
        >
          <FormField label="Bill up to date (challans on or before this date are included)">
            <TextInput type="date" value={uptoDate} onChange={(e) => setUptoDate(e.target.value)} />
          </FormField>
          <FormField label="Apply special discounts in this bill?">
            <Select value={applyDiscount ? "yes" : "no"} onChange={(e) => setApplyDiscount(e.target.value === "yes")}>
              <option value="yes">Yes — adjust discounts not yet billed</option>
              <option value="no">No — bill without discount adjustment</option>
            </Select>
          </FormField>
        </Modal>
      )}

      {printTarget &&
        printArea &&
        createPortal(
          <BillDoc
            settings={settings}
            project={{
              name: project.name,
              client: project.client,
              site: project.site,
              poNumber: project.poNumber,
              poDate: project.poDate,
              paymentTerms: project.paymentTerms,
              termsTransport: project.termsTransport,
            }}
            bill={printTarget}
            gstRatePct={gstRatePct}
            dfmt={dfmt}
          />,
          printArea
        )}

      {viewingBill && (
        <BillViewModal
          project={project}
          bill={viewingBill}
          settings={settings}
          gstRatePct={gstRatePct}
          onClose={() => setViewingId(null)}
        />
      )}

      {confirmDeleteId && (
        <ConfirmModal
          message="Delete this running bill?"
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={() => deleteMutation.mutate(confirmDeleteId)}
        />
      )}
    </Card>
  );
}
