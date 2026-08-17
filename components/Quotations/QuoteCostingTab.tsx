"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "../Card/Card";
import { StatsGrid } from "../StatsGrid/StatsGrid";
import { StatCard } from "../StatCard/StatCard";
import { Table, TableWrap, Td, Th } from "../Table/Table";
import { Button } from "../Button/Button";
import { Chip } from "../Chip/Chip";
import { FormField, FormRow } from "../Form/FormField";
import { TextInput } from "../Form/Inputs";
import { useToast } from "../Toast/ToastProvider";
import { apiFetch, ApiError } from "../../lib/apiClient";
import { inr } from "../../lib/format";
import { computeQuoteCosting, type CostingOverrides } from "../../services/costingService";
import { lineNetRate, quoteSections } from "../../services/quotationTotals";
import type { QuotationDto } from "../../services/quotationService";
import type { CostRate } from "../../services/catalogService";
import styles from "../ProjectDetail/Costing.module.css";

// Ported from renderQuoteCosting() — expected margin on a quotation before it
// is sent, grouped by the same areas as the quote itself.
export function QuoteCostingTab({
  quotation,
  costRates,
}: {
  quotation: QuotationDto;
  costRates: Record<string, CostRate>;
}) {
  const toast = useToast();
  const [costing, setCosting] = useState<CostingOverrides>(() => ({
    items: (quotation.costing?.items ?? {}) as CostingOverrides["items"],
    extras: (quotation.costing?.extras ?? []) as CostingOverrides["extras"],
    installPct: quotation.costing?.installPct,
  }));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const rateMap = useMemo(() => new Map(Object.entries(costRates)), [costRates]);

  const terms = {
    discountPct: quotation.discountPct,
    installMode: quotation.installMode,
    installBasis: quotation.installBasis,
    installValue: quotation.installValue,
    transportMode: quotation.transportMode,
    transportAmount: quotation.transportAmount,
    gstMode: quotation.gstMode,
    gstPct: quotation.gstPct,
    roundTo: quotation.roundTo,
    areaTotalsWithGst: quotation.areaTotalsWithGst,
  };

  // Net (post-discount) rate per line, from the same functions the quote and
  // the printed document use.
  const netRateById = useMemo(
    () =>
      new Map(
        quotation.items.map((i) => [
          i.id,
          lineNetRate(terms, { qty: i.qty, rate: i.rate, discPct: i.discPct }),
        ])
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- terms is derived from quotation
    [quotation]
  );

  const result = useMemo(
    () =>
      computeQuoteCosting({
        items: quotation.items.map((i) => ({
          id: i.id,
          description: i.description,
          section: i.section,
          makes: i.makes,
          unit: i.unit,
          qty: i.qty,
        })),
        netRateById,
        costing,
        costRates: rateMap,
        // Revenue = what the client pays after discount and installation and
        // after rounding, before GST — the figure the margin is measured on.
        revenue: quotation.totals.roundedAmount || quotation.totals.grandBeforeRounding,
      }),
    [quotation, netRateById, costing, rateMap]
  );

  const save = useCallback(
    async (next: CostingOverrides) => {
      setSaving(true);
      try {
        await apiFetch(`/api/quotations/${quotation.id}/costing`, {
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
    [quotation.id, toast]
  );

  const update = (fn: (prev: CostingOverrides) => CostingOverrides) =>
    setCosting((prev) => {
      const next = fn(prev);
      setDirty(true);
      void save(next);
      return next;
    });

  const sections = quoteSections(
    quotation.sections,
    quotation.items.map((i) => ({ section: i.section, qty: i.qty, rate: i.rate, discPct: i.discPct }))
  );
  const grouped = sections.length > 0;
  const order = grouped ? [...sections, ""] : [""];

  const instCharged =
    quotation.installMode === "EXTRA"
      ? quotation.installBasis === "LUMPSUM"
        ? `Lump sum ${inr(quotation.installValue)}`
        : quotation.installBasis === "PER_UNIT"
          ? `${inr(quotation.installValue)} per unit`
          : `${quotation.installValue}% of value`
      : null;

  return (
    <>
      <StatsGrid>
        <StatCard label="Quote value (after disc., before GST)" value={inr(result.revenue)} />
        <StatCard
          label="Material cost"
          value={`${inr(result.matCost)}${result.missing ? ` (${result.missing} missing)` : ""}`}
          tone={result.missing ? "neg" : undefined}
        />
        <StatCard
          label={`Installation cost${result.installPct !== null ? ` @ ${result.installPct}%` : ""}`}
          value={result.installPct === null ? "not set" : inr(result.instCost)}
        />
        <StatCard label="Other costs" value={inr(result.otherCost)} />
        <StatCard label="Total cost" value={inr(result.totalCost)} highlight />
        <StatCard
          label="Expected margin"
          value={`${inr(result.margin)} (${result.marginPct.toFixed(1)}%)`}
          tone={result.margin < 0 ? "neg" : "pos"}
        />
      </StatsGrid>

      <Card style={{ marginTop: 16 }}>
        <CardHeader>
          <CardTitle>
            Costing sheet — {quotation.ref} · {quotation.title}
          </CardTitle>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            {saving && <span className={styles.note}>Saving…</span>}
            {!saving && dirty && <span className={styles.warn}>Unsaved</span>}
          </div>
        </CardHeader>
        <CardBody>
          <div className={styles.block}>
            <FormRow>
              <FormField label="Installation costing % (our cost of installing, as % of material cost)">
                <TextInput
                  type="number"
                  min={0}
                  placeholder="e.g. 8"
                  value={result.installPct === null ? "" : result.installPct}
                  onChange={(e) =>
                    update((prev) => ({ ...prev, installPct: e.target.value === "" ? "" : Number(e.target.value) }))
                  }
                />
              </FormField>
              <div style={{ marginBottom: 14 }}>
                <span className={styles.note} style={{ display: "block", marginBottom: 5 }}>
                  Client is being charged for installation
                </span>
                <div style={{ fontSize: 13.5 }}>
                  {instCharged ? (
                    <>
                      {instCharged} = <b>{inr(quotation.totals.installAmount)}</b>
                    </>
                  ) : (
                    <b>Included in rates (no separate charge)</b>
                  )}
                </div>
              </div>
            </FormRow>
          </div>

          <p className={styles.note} style={{ marginBottom: 10 }}>
            Cost rate comes from the item sheet (purchase list price less our purchase discount) or the last actual
            purchase. Red boxes need a cost — type it here for this quote, or add it to the item sheet so every future
            quote gets it. Sale figures are after the line discount.
          </p>

          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th>Unit</Th>
                  <Th align="r">Qty</Th>
                  <Th align="r">Net sale rate</Th>
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
                      No items on this quotation yet.
                    </Td>
                  </tr>
                )}
                {order.map((sec) => {
                  const ls = result.lines.filter((l) => (l.section || "").trim() === sec);
                  if (!ls.length) return null;
                  const sc = ls.reduce((a, l) => a + l.cost, 0);
                  const ss = ls.reduce((a, l) => a + l.saleNet, 0);
                  return (
                    <Fragment key={`sec-${sec}`}>
                      {grouped && (
                        <tr>
                          <Td colSpan={10} style={{ background: "#F3F6F7", fontWeight: 700 }}>
                            {sec || "Other items"}
                          </Td>
                        </tr>
                      )}
                      {ls.map((l) => {
                        const m = l.saleNet - l.cost;
                        return (
                          <tr key={l.itemId}>
                            <Td>
                              {l.description}
                              {l.makes.length > 0 && <div className={styles.sub}>{l.makes.join(" / ")}</div>}
                            </Td>
                            <Td>{l.unit}</Td>
                            <Td align="r">{l.qty}</Td>
                            <Td align="r">{inr(l.netSaleRate)}</Td>
                            <Td align="r">
                              <TextInput
                                type="number"
                                placeholder="enter cost"
                                value={l.costRate === null ? "" : l.costRate}
                                title={l.overridden ? "Manually set" : l.basis ?? "No cost known — enter it here"}
                                onChange={(e) =>
                                  update((prev) => ({
                                    ...prev,
                                    items: {
                                      ...prev.items,
                                      [l.itemId]: { rate: e.target.value === "" ? "" : Number(e.target.value) },
                                    },
                                  }))
                                }
                                className={[
                                  styles.rate,
                                  l.overridden ? styles.manual : l.missing ? styles.missing : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                              />
                            </Td>
                            <Td>
                              {l.overridden ? (
                                <Chip tone="gold">manual</Chip>
                              ) : l.missing ? (
                                <Chip tone="red">missing</Chip>
                              ) : (
                                <Chip tone="teal" title={l.basis ?? undefined}>
                                  auto
                                </Chip>
                              )}
                            </Td>
                            <Td align="r">{l.missing ? "—" : inr(l.cost)}</Td>
                            <Td align="r">{inr(l.saleNet)}</Td>
                            <Td align="r" style={{ color: l.missing ? undefined : m < 0 ? "var(--danger)" : "var(--ok)" }}>
                              {l.missing ? "—" : inr(m)}
                              {!l.missing && l.saleNet > 0 && (
                                <span className={styles.sub}> {((m / l.saleNet) * 100).toFixed(1)}%</span>
                              )}
                            </Td>
                            <Td>
                              {l.overridden && (
                                <Button
                                  size="sm"
                                  title="Back to auto"
                                  aria-label="Reset to automatic cost"
                                  onClick={() =>
                                    update((prev) => {
                                      const items = { ...prev.items };
                                      delete items[l.itemId];
                                      return { ...prev, items };
                                    })
                                  }
                                >
                                  <RotateCcw size={13} />
                                </Button>
                              )}
                            </Td>
                          </tr>
                        );
                      })}
                      {grouped && (
                        <tr style={{ fontStyle: "italic" }}>
                          <Td colSpan={6} align="r">
                            Sub-total — {sec || "Other items"}
                          </Td>
                          <Td align="r">{inr(sc)}</Td>
                          <Td align="r">{inr(ss)}</Td>
                          <Td align="r">{inr(ss - sc)}</Td>
                          <Td />
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <Td colSpan={6} align="r">
                    Material totals
                  </Td>
                  <Td align="r">{inr(result.matCost)}</Td>
                  <Td align="r">{inr(quotation.totals.netAmount)}</Td>
                  <Td
                    align="r"
                    style={{
                      color: quotation.totals.netAmount - result.matCost < 0 ? "var(--danger)" : "var(--ok)",
                    }}
                  >
                    {inr(quotation.totals.netAmount - result.matCost)}
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
          <CardTitle>Other costs</CardTitle>
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
                      Site expenses, consumables, freight not recovered, commissions, contingencies…
                    </Td>
                  </tr>
                )}
                {costing.extras.map((x, i) => (
                  <tr key={i}>
                    <Td>
                      <TextInput
                        value={x.name}
                        placeholder="e.g. Site expenses, Consumables, Commission"
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
                        className={styles.rate}
                        value={x.amount}
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
            </Table>
          </TableWrap>
          <p className={styles.note} style={{ marginTop: 8 }}>
            {quotation.transportMode === "EXTRA"
              ? `Transport is quoted extra (${inr(quotation.transportAmount)}) — pass-through, not counted as cost. If our actual freight will exceed it, add the difference as an "other cost".`
              : "Transport is included in the rates — add the expected freight as an “other cost” line so the margin is realistic."}
          </p>
        </CardBody>
      </Card>
    </>
  );
}
