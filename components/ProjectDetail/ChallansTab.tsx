"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import { usePrintPortal } from "../../hooks/usePrintPortal";
import { Card, CardBody, CardHeader } from "../Card/Card";
import { TableWrap, Table, Th, Td, EmptyState } from "../Table/Table";
import { Button } from "../Button/Button";
import { Chip } from "../Chip/Chip";
import { ConfirmModal } from "../Modal/ConfirmModal";
import { PasswordModal } from "../Modal/PasswordModal";
import { ChallanDoc } from "../PrintDoc/ChallanDoc";
import { ChallanViewModal } from "./ChallanViewModal";
import { IssueChallanModal } from "./IssueChallanModal";
import { AttachChallanModal } from "./AttachChallanModal";
import { inr, dfmt } from "../../lib/format";
import { apiFetch } from "../../lib/apiClient";
import { useToast } from "../Toast/ToastProvider";
import type { CompanySettings } from "../PrintDoc/DocHead";
import type { ProjectViewModel } from "../../modules/projects/viewModel";

type PendingAction = { type: "edit" | "delete"; challanId: string } | null;

// Ported from tabChallans(p, el) — challan list + Issue/Attach entry points.
// appPassword: the prototype's APP_PWD soft gate on edit/delete, now
// configurable in Settings — still a client-side accident-preventer, not a
// security boundary (the whole app is public/no-login by design).
export function ChallansTab({
  project,
  settings,
  appPassword,
}: {
  project: ProjectViewModel;
  settings: CompanySettings;
  appPassword: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [issueOpen, setIssueOpen] = useState<{ editingId?: string } | null>(null);
  const [attachOpen, setAttachOpen] = useState<{ editingId?: string } | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { target: printTarget, printArea, print } = usePrintPortal<ProjectViewModel["challans"][number]>();

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/challans/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      router.refresh();
      setConfirmDeleteId(null);
      toast("Challan deleted");
    },
    onError: (err) => toast(err instanceof Error ? err.message : "Failed to delete challan"),
  });

  const viewingChallan = viewingId ? project.challans.find((c) => c.id === viewingId) : undefined;

  return (
    <Card>
      <CardHeader>
        <h3>Delivery Challans</h3>
        <Button size="sm" variant="primary" style={{ marginLeft: "auto" }} onClick={() => setIssueOpen({})}>
          + Issue new challan
        </Button>
        <Button size="sm" onClick={() => setAttachOpen({})}>
          Attach Zoho challan
        </Button>
      </CardHeader>
      <CardBody>
        {project.challans.length === 0 ? (
          <EmptyState>No challans yet. Issue a challan from here, or attach challans already made in Zoho.</EmptyState>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Challan No.</Th>
                  <Th>Date</Th>
                  <Th>Source</Th>
                  <Th align="r">Items</Th>
                  <Th align="r">Addl. items</Th>
                  <Th align="r">Value</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {project.challans.map((c) => {
                  const nAdd = c.items.filter((ci) => ci.extraQty > 0).length + c.extraItems.length;
                  return (
                    <tr key={c.id}>
                      <Td className="mono">
                        <b>{c.no}</b>
                      </Td>
                      <Td style={{ whiteSpace: "nowrap" }}>{dfmt(c.date)}</Td>
                      <Td>
                        <Chip tone={c.source === "ISSUED_HERE" ? "teal" : "grey"}>
                          {c.source === "ISSUED_HERE" ? "Issued here" : "Zoho"}
                        </Chip>
                      </Td>
                      <Td align="r">{c.items.length || "—"}</Td>
                      <Td align="r">{nAdd || "—"}</Td>
                      <Td align="r" className="money">
                        {inr(c.value)}
                      </Td>
                      <Td style={{ whiteSpace: "nowrap" }}>
                        <Button size="sm" onClick={() => setViewingId(c.id)}>
                          View
                        </Button>{" "}
                        {c.source === "ISSUED_HERE" && (
                          <Button size="sm" onClick={() => print(c)}>
                            Print
                          </Button>
                        )}{" "}
                        <Button size="sm" onClick={() => setPending({ type: "edit", challanId: c.id })}>
                          Edit
                        </Button>{" "}
                        <Button size="sm" variant="danger" onClick={() => setPending({ type: "delete", challanId: c.id })}>
                          Delete
                        </Button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </CardBody>

      {issueOpen && <IssueChallanModal project={project} editingId={issueOpen.editingId} onClose={() => setIssueOpen(null)} />}
      {attachOpen && <AttachChallanModal project={project} editingId={attachOpen.editingId} onClose={() => setAttachOpen(null)} />}
      {viewingChallan && (
        <ChallanViewModal project={project} challan={viewingChallan} settings={settings} onClose={() => setViewingId(null)} />
      )}
      {printTarget &&
        printArea &&
        createPortal(
          <ChallanDoc
            settings={settings}
            project={{ name: project.name, client: project.client, site: project.site, poNumber: project.poNumber }}
            challan={printTarget}
            soItems={project.items}
            dfmt={dfmt}
          />,
          printArea
        )}

      {pending && (
        <PasswordModal
          action={pending.type === "edit" ? "edit" : "delete"}
          expectedPassword={appPassword}
          onCancel={() => setPending(null)}
          onSuccess={() => {
            const id = pending.challanId;
            const action = pending.type;
            setPending(null);
            if (action === "delete") {
              setConfirmDeleteId(id);
            } else {
              const target = project.challans.find((c) => c.id === id);
              if (target?.source === "ISSUED_HERE") setIssueOpen({ editingId: id });
              else setAttachOpen({ editingId: id });
            }
          }}
        />
      )}
      {confirmDeleteId && (
        <ConfirmModal
          message="Delete this challan? Running bills already generated will not change."
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={() => deleteMutation.mutate(confirmDeleteId)}
        />
      )}
    </Card>
  );
}
