"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Card, CardBody, CardHeader } from "../Card/Card";
import { TableWrap, Table, Th, Td, EmptyState } from "../Table/Table";
import { TextInput, Select } from "../Form/Inputs";
import { Button } from "../Button/Button";
import { Chip } from "../Chip/Chip";
import { ConfirmModal } from "../Modal/ConfirmModal";
import { PasswordModal } from "../Modal/PasswordModal";
import { SplitItemModal } from "./SplitItemModal";
import { AmendSalesOrderModal } from "./AmendSalesOrderModal";
import { AddOrderModal } from "./AddOrderModal";
import { inr, dfmt } from "../../lib/format";
import { apiFetch } from "../../lib/apiClient";
import { useToast } from "../Toast/ToastProvider";
import type { ProjectViewModel } from "../../modules/projects/viewModel";

type Item = ProjectViewModel["items"][number];

interface Section {
  id: string | null;
  ref: string;
  date: string | null;
  attachmentUrl: string | null;
  original: boolean;
}

// Ported from tabSO(p, el) — Sales Order per-order sections with GST/transport
// term selectors, make column, split-item, amend-SO, add-order, delete-order
// and delete-sales-order (password-gated) actions.
export function SalesOrderTab({
  project,
  gstRatePct,
  appPassword,
}: {
  project: ProjectViewModel;
  gstRatePct: number;
  appPassword: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [splitItem, setSplitItem] = useState<Item | null>(null);
  const [amendOpen, setAmendOpen] = useState(false);
  const [addOrderOpen, setAddOrderOpen] = useState(false);
  // Password-then-confirm chains for the destructive actions.
  const [pwdFor, setPwdFor] = useState<{ action: "deleteSO" | "deleteOrder"; orderId?: string } | null>(null);
  const [confirmFor, setConfirmFor] = useState<{ action: "deleteSO" | "deleteOrder"; orderId?: string } | null>(null);

  const orderCopy = project.documents.find((d) => d.kind === "ORDER_COPY");
  const sections: Section[] = [
    {
      id: null,
      ref: "Original order" + (project.poNumber ? " — " + project.poNumber : ""),
      date: project.poDate,
      attachmentUrl: orderCopy?.url ?? null,
      original: true,
    },
    ...project.orders.map((o) => ({
      id: o.id,
      ref: o.ref,
      date: o.date,
      attachmentUrl: o.attachments[0]?.url ?? null,
      original: false,
    })),
  ];
  const multi = sections.length > 1;

  const termsMutation = useMutation({
    mutationFn: (patch: { termsGst?: string; termsTransport?: string }) =>
      apiFetch(`/api/projects/${project.id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: () => router.refresh(),
    onError: () => toast("Failed to update terms"),
  });

  const addMutation = useMutation({
    mutationFn: (orderId: string | null) =>
      apiFetch(`/api/projects/${project.id}/items`, {
        method: "POST",
        body: JSON.stringify({ description: "", make: "", unit: "Nos", qty: 1, rate: 0, orderId }),
      }),
    onSuccess: () => router.refresh(),
    onError: () => toast("Failed to add item"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Item> }) =>
      apiFetch(`/api/projects/${project.id}/items/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: () => router.refresh(),
    onError: () => toast("Failed to update item"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/projects/${project.id}/items/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      router.refresh();
      setConfirmDeleteId(null);
    },
    onError: () => toast("Failed to remove item"),
  });

  const deleteSoMutation = useMutation({
    mutationFn: () => apiFetch(`/api/projects/${project.id}/sales-order`, { method: "DELETE" }),
    onSuccess: () => {
      router.refresh();
      setConfirmFor(null);
      toast("Sales order deleted");
    },
    onError: () => toast("Failed to delete sales order"),
  });

  const deleteOrderMutation = useMutation({
    mutationFn: (orderId: string) => apiFetch(`/api/orders/${orderId}`, { method: "DELETE" }),
    onSuccess: () => {
      router.refresh();
      setConfirmFor(null);
      toast("Order deleted");
    },
    onError: () => toast("Failed to delete order"),
  });

  const soBase = project.financials.orderBase;
  const gstExtra = project.termsGst === "EXTRA";
  const soGst = gstExtra ? soBase * ((Number(gstRatePct) || 18) / 100) : 0;

  let sn = 0;

  const renderItemRow = (it: Item, i: number) => {
    sn += 1;
    return (
      <tr key={it.id}>
        <Td>{sn}</Td>
        <Td>
          <TextInput
            defaultValue={it.description}
            onBlur={(e) =>
              e.target.value !== it.description && updateMutation.mutate({ id: it.id, patch: { description: e.target.value } })
            }
          />
          {it.splitFrom && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>part of: {it.splitFrom}</div>
          )}
        </Td>
        <Td>
          <TextInput
            style={{ width: 88 }}
            placeholder="Make"
            defaultValue={it.make}
            onBlur={(e) => e.target.value !== it.make && updateMutation.mutate({ id: it.id, patch: { make: e.target.value } })}
          />
        </Td>
        <Td>
          <TextInput
            style={{ width: 64 }}
            defaultValue={it.unit}
            onBlur={(e) => e.target.value !== it.unit && updateMutation.mutate({ id: it.id, patch: { unit: e.target.value } })}
          />
        </Td>
        <Td align="r">
          <TextInput
            type="number"
            step="any"
            style={{ width: 84, textAlign: "right" }}
            defaultValue={it.qty}
            onBlur={(e) =>
              Number(e.target.value) !== it.qty && updateMutation.mutate({ id: it.id, patch: { qty: Number(e.target.value) || 0 } })
            }
          />
        </Td>
        <Td align="r">
          <TextInput
            type="number"
            step="any"
            style={{ width: 104, textAlign: "right" }}
            defaultValue={it.rate}
            onBlur={(e) =>
              Number(e.target.value) !== it.rate && updateMutation.mutate({ id: it.id, patch: { rate: Number(e.target.value) || 0 } })
            }
          />
        </Td>
        <Td align="r" className="money">
          {inr(it.qty * it.rate)}
        </Td>
        <Td align="r" className="money">
          {it.dispatchedQty}
          {it.extraQty > 0 && (
            <>
              {" "}
              <Chip tone="gold" title="Additional qty beyond BOQ">
                +{it.extraQty}
              </Chip>
            </>
          )}
        </Td>
        <Td align="r" className="money" style={{ color: it.balanceQty < 0 ? "var(--danger)" : "inherit" }}>
          {it.balanceQty}
        </Td>
        <Td style={{ whiteSpace: "nowrap" }}>
          <Button size="sm" title="Bifurcate this item into smaller items" onClick={() => setSplitItem(it)}>
            Split
          </Button>{" "}
          <Button size="sm" variant="danger" aria-label="Remove item" onClick={() => setConfirmDeleteId(it.id)}>
            <X size={14} />
          </Button>
        </Td>
      </tr>
    );
  };

  return (
    <Card>
      <CardHeader>
        <h3>Sales Order{project.aiGenerated ? <span className="ai-badge" style={{ marginLeft: 6 }}>AI-drafted</span> : null}</h3>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Select
            style={{ width: "auto" }}
            title="Whether GST is extra on these amounts or already included in the rates"
            value={project.termsGst}
            onChange={(e) => {
              termsMutation.mutate({ termsGst: e.target.value });
              toast(
                e.target.value === "EXTRA"
                  ? "GST will be added on bills and summary"
                  : "Rates treated as GST-inclusive — no GST added anywhere"
              );
            }}
          >
            <option value="EXTRA">GST extra @ {gstRatePct}%</option>
            <option value="INCLUDED">GST included in rates</option>
          </Select>
          <Select
            style={{ width: "auto" }}
            title="Whether transport is extra at actuals or included in the rates"
            value={project.termsTransport}
            onChange={(e) => {
              termsMutation.mutate({ termsTransport: e.target.value });
              toast(
                e.target.value === "EXTRA"
                  ? "Transport bills will be added to client running bills at actuals"
                  : "Transport treated as internal cost — not billed to client"
              );
            }}
          >
            <option value="EXTRA">Transport extra at actuals</option>
            <option value="INCLUDED">Transport included</option>
          </Select>
          <Button size="sm" variant="primary" onClick={() => setAddOrderOpen(true)}>
            + Add new order
          </Button>
          <Button size="sm" onClick={() => setAmendOpen(true)}>
            Amend sales order
          </Button>
          <Button size="sm" variant="danger" onClick={() => setPwdFor({ action: "deleteSO" })}>
            Delete sales order
          </Button>
        </div>
      </CardHeader>
      <CardBody>
        {project.items.length === 0 && project.orders.length === 0 && (
          <EmptyState>
            No sales order items yet. Attach the PO/BOQ in Documents and re-run AI reading, add a new order, or add
            items manually.
          </EmptyState>
        )}
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th style={{ width: "30%" }}>Description</Th>
                <Th>Make</Th>
                <Th>Unit</Th>
                <Th align="r">Ordered Qty</Th>
                <Th align="r">Rate</Th>
                <Th align="r">Amount</Th>
                <Th align="r">Dispatched</Th>
                <Th align="r">Balance Qty</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {sections.map((sec) => {
                const secItems = project.items.filter((it) => (it.orderId || null) === (sec.id || null));
                const sub = secItems.reduce((t, x) => t + x.qty * x.rate, 0);
                return (
                  <SectionRows
                    key={sec.id ?? "orig"}
                    sec={sec}
                    multi={multi}
                    subTotal={sub}
                    onAddItem={() => addMutation.mutate(sec.id)}
                    onDeleteOrder={() => setPwdFor({ action: "deleteOrder", orderId: sec.id! })}
                  >
                    {secItems.map((it, i) => renderItemRow(it, i))}
                  </SectionRows>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <Td colSpan={6} align="r">
                  Basic value (all orders)
                </Td>
                <Td align="r" className="money">
                  {inr(soBase)}
                </Td>
                <Td colSpan={3}></Td>
              </tr>
              {gstExtra && (
                <>
                  <tr>
                    <Td colSpan={6} align="r">
                      GST @ {gstRatePct}% (extra)
                    </Td>
                    <Td align="r" className="money">
                      {inr(soGst)}
                    </Td>
                    <Td colSpan={3}></Td>
                  </tr>
                  <tr>
                    <Td colSpan={6} align="r">
                      <b>Sales order value incl. GST</b>
                    </Td>
                    <Td align="r" className="money">
                      <b>{inr(soBase + soGst)}</b>
                    </Td>
                    <Td colSpan={3}></Td>
                  </tr>
                </>
              )}
            </tfoot>
          </Table>
        </TableWrap>
        {!multi && (
          <div style={{ marginTop: 10 }}>
            <Button size="sm" onClick={() => addMutation.mutate(null)} disabled={addMutation.isPending}>
              + Add item
            </Button>
          </div>
        )}
      </CardBody>

      {confirmDeleteId && (
        <ConfirmModal
          message="Remove this sales order item?"
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={() => deleteMutation.mutate(confirmDeleteId)}
        />
      )}
      {splitItem && <SplitItemModal projectId={project.id} item={splitItem} onClose={() => setSplitItem(null)} />}
      {amendOpen && <AmendSalesOrderModal project={project} onClose={() => setAmendOpen(false)} />}
      {addOrderOpen && <AddOrderModal project={project} onClose={() => setAddOrderOpen(false)} />}

      {pwdFor && (
        <PasswordModal
          action={pwdFor.action === "deleteSO" ? "delete the entire sales order of" : "delete this order from"}
          expectedPassword={appPassword}
          onCancel={() => setPwdFor(null)}
          onSuccess={() => {
            setConfirmFor(pwdFor);
            setPwdFor(null);
          }}
        />
      )}
      {confirmFor && (
        <ConfirmModal
          message={
            confirmFor.action === "deleteSO"
              ? "Delete the ENTIRE sales order (all orders and items) of this project? Challan quantity links to these items will be lost and dispatched value will drop accordingly. Bills already generated remain as saved."
              : "Delete this order and all its items? Challan links to its items will be lost."
          }
          onCancel={() => setConfirmFor(null)}
          onConfirm={() =>
            confirmFor.action === "deleteSO" ? deleteSoMutation.mutate() : deleteOrderMutation.mutate(confirmFor.orderId!)
          }
        />
      )}
    </Card>
  );
}

// One order section: header row (shown when the project has multiple orders,
// or always for additional orders) followed by its item rows and sub-total.
function SectionRows({
  sec,
  multi,
  subTotal,
  onAddItem,
  onDeleteOrder,
  children,
}: {
  sec: Section;
  multi: boolean;
  subTotal: number;
  onAddItem: () => void;
  onDeleteOrder: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      {(multi || !sec.original) && (
        <tr>
          <Td colSpan={10} style={{ background: "#F3F6F7" }}>
            <b>{sec.ref}</b>
            {sec.date ? ` · ${dfmt(sec.date)}` : ""}
            <span style={{ float: "right", display: "flex", gap: 6 }}>
              {sec.attachmentUrl && (
                <Button size="sm" onClick={() => window.open(sec.attachmentUrl!, "_blank")}>
                  Order copy
                </Button>
              )}
              <Button size="sm" onClick={onAddItem}>
                + Item
              </Button>
              {!sec.original && (
                <Button size="sm" variant="danger" onClick={onDeleteOrder}>
                  Delete order
                </Button>
              )}
            </span>
          </Td>
        </tr>
      )}
      {children}
      {multi && (
        <tr>
          <Td colSpan={6} align="r">
            <i>Sub-total — {sec.ref}</i>
          </Td>
          <Td align="r" className="money">
            <i>{inr(subTotal)}</i>
          </Td>
          <Td colSpan={3}></Td>
        </tr>
      )}
    </>
  );
}
