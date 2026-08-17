"use client";

import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { RotateCcw, Trash2 } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "../Card/Card";
import { StatsGrid } from "../StatsGrid/StatsGrid";
import { StatCard } from "../StatCard/StatCard";
import { Table, TableWrap, Td, Th } from "../Table/Table";
import { Button } from "../Button/Button";
import { Chip } from "../Chip/Chip";
import { TextInput } from "../Form/Inputs";
import { CostingDoc } from "../PrintDoc/CostingDoc";
import type { CompanySettings } from "../PrintDoc/DocHead";
import { useToast } from "../Toast/ToastProvider";
import { usePrintPortal } from "../../hooks/usePrintPortal";
import { apiFetch, ApiError } from "../../lib/apiClient";
import { inr } from "../../lib/format";
import { computeProjectCosting, type CostingOverrides } from "../../services/costingService";
import type { ProjectViewModel } from "../../modules/projects/viewModel";
import type { CostRate } from "../../services/catalogService";
import styles from "./Costing.module.css";

// Ported from tabCosting() — one costing line per Sales Order item, with the
// automatic cost rate resolved from the item sheet (or the last real purchase)
// and per-project overrides typed in place.
export function CostingTab({
  project,
  settings,
  costRates,
}: {
  project: ProjectViewModel;
  settings: CompanySettings;
  /** normName -> cost rate, resolved server-side. */
  costRates: Record<string, CostRate>;
}) {
  const toast = useToast();
  const [costing, setCosting] = useState<CostingOverrides>(() => ({
    items: (project.costing?.items ?? {}) as CostingOverrides["items"],
    extras: (project.costing?.extras ?? []) as CostingOverrides["extras"],
  }));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const { target: printTarget, printArea, print } = usePrintPortal<true>();

  const rateMap = useMemo(() => new Map(Object.entries(costRates)), [costRates]);

  const result = useMemo(
    () =>
      computeProjectCosting({
        items: project.items.map((i) => ({
          id: i.id,
          description: i.description,
          make: i.make,
          unit: i.unit,
          qty: i.qty,
          rate: i.rate,
        })),
        costing,
        costRates: rateMap,
        transportTotal: project.financials.transportTotal,
        transportIsIncluded: project.termsTransport === "INCLUDED",
        discountTotal: project.financials.discountTotal,
      }),
    [project, costing, rateMap]
  );

  // Persist on change (debounce-free: these are deliberate edits, and the
  // payload is small) — the sheet is useless if it silently forgets.
  const save = useCallback(
    async (next: CostingOverrides) => {
      setSaving(true);
      try {
        await apiFetch(`/api/projects/${project.id}/costing`, {
          method: "PATCH",
          body: JSON.stringify(next),
        });
        setDirty(false);
      } catch (err) {
        setDirty(true);
        toast(err instanceof ApiError ? err.message : "Could not save the costing — check your connection.");
      } finally {
        setSaving(false);
      }
    },
    [project.id, toast]
  );

  const update = (fn: (prev: CostingOverrides) => CostingOverrides) => {
    setCosting((prev) => {
      const next = fn(prev);
      setDirty(true);
      void save(next);
      return next;
    });
  };

  const setItem = (itemId: string, patch: { rate?: number | ""; qty?: number | "" }) =>
    update((prev) => ({ ...prev, items: { ...prev.items, [itemId]: { ...prev.items[itemId], ...patch } } }));

  const resetRate = (itemId: string) =>
    update((prev) => {
      const items = { ...prev.items };
      if (items[itemId]) {
        const { rate, ...rest } = items[itemId];
        void rate;
        items[itemId] = rest;
      }
      return { ...prev, items };
    });

  return (
    <>
      <StatsGrid>
        <StatCard label="Sales order value (basic)" value={inr(result.sale)} />
        {result.discounts > 0 && (
          <StatCard label="Less special discounts" value={`− ${inr(result.discounts)}`} tone="neg" />
        )}
        <StatCard label="Material cost" value={inr(result.matCost)} />
        <StatCard
          label={`Other costs${result.transportCost ? " + transport" : ""}`}
          value={inr(result.otherCost + result.transportCost)}
        />
        <StatCard label="Total cost" value={inr(result.totalCost)} highlight />
        <StatCard
          label="Gross margin"
          value={`${inr(result.margin)} (${result.marginPct.toFixed(1)}%)`}
          tone={result.margin < 0 ? "neg" : "pos"}
        />
      </StatsGrid>

      <Card style={{ marginTop: 16 }}>
        <CardHeader>
          <CardTitle>Material costing</CardTitle>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {saving && <span className={styles.note}>Saving…</span>}
            {!saving && dirty && <span className={styles.warn}>Unsaved</span>}
            <Button size="sm" variant="primary" onClick={() => print(true)}>
              Print costing sheet
            </Button>
          </div>
        </CardHeader>
        <CardBody>
          <p className={styles.note} style={{ marginBottom: 10 }}>
            Cost rate is picked automatically from the item sheet — purchase list price less our purchase discount — or,
            if that is not set, from the last actual purchase. Type in the box to override for this project
            (highlighted); ↺ returns to auto.
          </p>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th>Unit</Th>
                  <Th align="r">Qty</Th>
                  <Th align="r">Sale rate</Th>
                  <Th align="r">Cost rate</Th>
                  <Th>Basis</Th>
                  <Th align="r">Cost</Th>
                  <Th align="r">Sale</Th>
                  <Th align="r">Margin</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {result.lines.length === 0 && (
                  <tr>
                    <Td colSpan={10} className={styles.note}>
                      No sales order items yet.
                    </Td>
                  </tr>
                )}
                {result.lines.map((l) => {
                  const lineMargin = l.sale - l.cost;
                  return (
                    <tr key={l.itemId}>
                      <Td>
                        {l.description}
                        {l.make && <div className={styles.sub}>{l.make}</div>}
                      </Td>
                      <Td>{l.unit}</Td>
                      <Td align="r">
                        <TextInput
                          type="number"
                          value={l.qty}
                          title="Costing qty (defaults to the sales order qty)"
                          onChange={(e) =>
                            setItem(l.itemId, { qty: e.target.value === "" ? "" : Number(e.target.value) })
                          }
                          className={styles.qty}
                        />
                      </Td>
                      <Td align="r">{inr(l.saleRate)}</Td>
                      <Td align="r">
                        <TextInput
                          type="number"
                          value={l.costRate}
                          title={l.overridden ? "Manually set" : l.basis ?? "No cost known — enter it manually"}
                          onChange={(e) =>
                            setItem(l.itemId, { rate: e.target.value === "" ? "" : Number(e.target.value) })
                          }
                          className={[styles.rate, l.overridden ? styles.manual : ""].filter(Boolean).join(" ")}
                        />
                      </Td>
                      <Td>
                        {l.overridden ? (
                          <Chip tone="gold">manual</Chip>
                        ) : l.hasAutoCost ? (
                          <Chip tone="teal" title={l.basis ?? undefined}>
                            auto
                          </Chip>
                        ) : (
                          <Chip tone="red">no cost</Chip>
                        )}
                      </Td>
                      <Td align="r">{inr(l.cost)}</Td>
                      <Td align="r">{inr(l.sale)}</Td>
                      <Td align="r" style={{ color: lineMargin < 0 ? "var(--danger)" : "var(--ok)" }}>
                        {inr(lineMargin)}
                        {l.sale > 0 && <span className={styles.sub}> {((lineMargin / l.sale) * 100).toFixed(1)}%</span>}
                      </Td>
                      <Td>
                        {l.overridden && (
                          <Button size="sm" title="Back to auto cost" aria-label="Reset to automatic cost" onClick={() => resetRate(l.itemId)}>
                            <RotateCcw size={13} />
                          </Button>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <Td colSpan={6} align="r">
                    Material totals
                  </Td>
                  <Td align="r">{inr(result.matCost)}</Td>
                  <Td align="r">{inr(result.sale)}</Td>
                  <Td align="r" style={{ color: result.sale - result.matCost < 0 ? "var(--danger)" : "var(--ok)" }}>
                    {inr(result.sale - result.matCost)}
                  </Td>
                  <Td />
                </tr>
              </tfoot>
            </Table>
          </TableWrap>
        </CardBody>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <CardHeader>
          <CardTitle>Other project costs</CardTitle>
          <Button
            size="sm"
            style={{ marginLeft: "auto" }}
            onClick={() => update((prev) => ({ ...prev, extras: [...prev.extras, { name: "", amount: 0 }] }))}
          >
            + Add cost line
          </Button>
        </CardHeader>
        <CardBody>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Cost head</Th>
                  <Th align="r">Amount (₹)</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {costing.extras.length === 0 && (
                  <tr>
                    <Td colSpan={3} className={styles.note}>
                      Add labour, installation crew, site expenses, consumables, commissions, etc.
                    </Td>
                  </tr>
                )}
                {costing.extras.map((x, i) => (
                  <tr key={i}>
                    <Td>
                      <TextInput
                        value={x.name}
                        placeholder="e.g. Labour / Installation crew, Site expenses"
                        onChange={(e) =>
                          update((prev) => ({
                            ...prev,
                            extras: prev.extras.map((row, idx) => (idx === i ? { ...row, name: e.target.value } : row)),
                          }))
                        }
                      />
                    </Td>
                    <Td align="r">
                      <TextInput
                        type="number"
                        value={x.amount}
                        className={styles.rate}
                        onChange={(e) =>
                          update((prev) => ({
                            ...prev,
                            extras: prev.extras.map((row, idx) =>
                              idx === i ? { ...row, amount: Number(e.target.value) || 0 } : row
                            ),
                          }))
                        }
                      />
                    </Td>
                    <Td>
                      <Button
                        size="sm"
                        variant="danger"
                        aria-label={`Remove cost line ${x.name || i + 1}`}
                        onClick={() =>
                          update((prev) => ({ ...prev, extras: prev.extras.filter((_, idx) => idx !== i) }))
                        }
                      >
                        <Trash2 size={14} />
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
              {result.transportCost > 0 && (
                <tfoot>
                  <tr>
                    <Td>Transport (included in rates — from the Transport tab)</Td>
                    <Td align="r">{inr(result.transportCost)}</Td>
                    <Td />
                  </tr>
                </tfoot>
              )}
            </Table>
          </TableWrap>
          {project.termsTransport === "EXTRA" && (
            <p className={styles.note} style={{ marginTop: 8 }}>
              Transport is billed extra to the client on this project, so it is not counted as our cost.
            </p>
          )}
        </CardBody>
      </Card>

      {printTarget && printArea
        ? createPortal(<CostingDoc settings={settings} project={project} result={result} />, printArea)
        : null}
    </>
  );
}
