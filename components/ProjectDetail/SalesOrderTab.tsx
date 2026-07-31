"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Card, CardBody, CardHeader } from "../Card/Card";
import { TableWrap, Table, Th, Td, EmptyState } from "../Table/Table";
import { TextInput } from "../Form/Inputs";
import { Button } from "../Button/Button";
import { Chip } from "../Chip/Chip";
import { ConfirmModal } from "../Modal/ConfirmModal";
import { inr } from "../../lib/format";
import { apiFetch } from "../../lib/apiClient";
import { useToast } from "../Toast/ToastProvider";
import type { ProjectViewModel } from "../../modules/projects/viewModel";

type Item = ProjectViewModel["items"][number];

// Ported from tabSO(p, el) — editable Sales Order table with ordered qty,
// rate, amount, and (once challans exist in a later phase) dispatched/balance
// qty columns.
export function SalesOrderTab({ project }: { project: ProjectViewModel }) {
  const router = useRouter();
  const toast = useToast();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const addMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/projects/${project.id}/items`, {
        method: "POST",
        body: JSON.stringify({ description: "", unit: "Nos", qty: 1, rate: 0 }),
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

  return (
    <Card>
      <CardHeader>
        <h3>Sales Order</h3>
        <Button size="sm" style={{ marginLeft: "auto" }} onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>
          + Add item
        </Button>
      </CardHeader>
      <CardBody>
        {project.items.length === 0 ? (
          <EmptyState>No sales order items yet. Add items manually below.</EmptyState>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th style={{ width: "40%" }}>Description</Th>
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
                {project.items.map((it, i) => (
                  <tr key={it.id}>
                    <Td>{i + 1}</Td>
                    <Td>
                      <TextInput
                        defaultValue={it.description}
                        onBlur={(e) =>
                          e.target.value !== it.description &&
                          updateMutation.mutate({ id: it.id, patch: { description: e.target.value } })
                        }
                      />
                    </Td>
                    <Td>
                      <TextInput
                        style={{ width: 64 }}
                        defaultValue={it.unit}
                        onBlur={(e) =>
                          e.target.value !== it.unit && updateMutation.mutate({ id: it.id, patch: { unit: e.target.value } })
                        }
                      />
                    </Td>
                    <Td align="r">
                      <TextInput
                        type="number"
                        step="any"
                        style={{ width: 84, textAlign: "right" }}
                        defaultValue={it.qty}
                        onBlur={(e) =>
                          Number(e.target.value) !== it.qty &&
                          updateMutation.mutate({ id: it.id, patch: { qty: Number(e.target.value) || 0 } })
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
                          Number(e.target.value) !== it.rate &&
                          updateMutation.mutate({ id: it.id, patch: { rate: Number(e.target.value) || 0 } })
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
                          <Chip tone="gold">+{it.extraQty}</Chip>
                        </>
                      )}
                    </Td>
                    <Td align="r" className="money" style={{ color: it.balanceQty < 0 ? "var(--danger)" : "inherit" }}>
                      {it.balanceQty}
                    </Td>
                    <Td>
                      <Button size="sm" variant="danger" aria-label="Remove item" onClick={() => setConfirmDeleteId(it.id)}>
                        <X size={14} />
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <Td colSpan={5} align="r">
                    Basic value
                  </Td>
                  <Td align="r" className="money">
                    {inr(project.financials.orderBase)}
                  </Td>
                  <Td colSpan={3}></Td>
                </tr>
              </tfoot>
            </Table>
          </TableWrap>
        )}
      </CardBody>
      {confirmDeleteId && (
        <ConfirmModal
          message="Remove this sales order item?"
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={() => deleteMutation.mutate(confirmDeleteId)}
        />
      )}
    </Card>
  );
}
