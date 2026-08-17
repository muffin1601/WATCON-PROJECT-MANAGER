"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2, Plus } from "lucide-react";
import { BackLink } from "../BackLink/BackLink";
import { Card, CardBody, CardHeader, CardTitle } from "../Card/Card";
import { Table, TableWrap, Td, Th } from "../Table/Table";
import { Button } from "../Button/Button";
import { Chip } from "../Chip/Chip";
import { FormField, FormRow } from "../Form/FormField";
import { TextInput, Select, Textarea } from "../Form/Inputs";
import { Modal } from "../Modal/Modal";
import { ConfirmModal } from "../Modal/ConfirmModal";
import { CustomerPicker, type CustomerOption } from "../Customers/CustomerPicker";
import { ItemPicker, type CatalogOption } from "../Catalog/ItemPicker";
import { QuotationDoc } from "../PrintDoc/QuotationDoc";
import type { CompanySettings } from "../PrintDoc/DocHead";
import { useToast } from "../Toast/ToastProvider";
import { usePrintPortal } from "../../hooks/usePrintPortal";
import { apiFetch, ApiError } from "../../lib/apiClient";
import { inr, todayIso } from "../../lib/format";
import {
  lineDisc,
  lineNet,
  lineNetRate,
  quoteSectionNet,
  quoteSections,
  quoteTotals,
  type QuoteTerms,
} from "../../services/quotationTotals";
import {
  QUOTATION_STATUS_LABEL,
  QUOTE_DEFAULT_TERMS,
  SELECTABLE_QUOTATION_STATUSES,
} from "../../modules/quotations/schema";
import { STATUS_TONE } from "./QuotationsClient";
import type { QuotationDto } from "../../services/quotationService";
import type { CostRate } from "../../services/catalogService";
import { QuoteCostingTab } from "./QuoteCostingTab";
import { Tabs } from "../Tabs/Tabs";
import styles from "./Quotations.module.css";

interface LineDraft {
  key: string;
  catalogItemId: string | null;
  section: string;
  description: string;
  makes: string[];
  unit: string;
  qty: string;
  rate: string;
  discPct: string;
}

const QUOTE_TABS = [
  { key: "quote" as const, label: "Quotation" },
  { key: "costing" as const, label: "Costing sheet" },
];

let keySeq = 0;
const newKey = () => `l${++keySeq}`;

const num = (v: string): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function toDrafts(q: QuotationDto | null): LineDraft[] {
  if (!q) return [];
  return q.items.map((i) => ({
    key: newKey(),
    catalogItemId: i.catalogItemId,
    section: i.section,
    description: i.description,
    makes: i.makes,
    unit: i.unit,
    qty: String(i.qty),
    rate: String(i.rate),
    discPct: i.discPct === null ? "" : String(i.discPct),
  }));
}

// Quotation editor — create and edit share this one screen. Totals are
// previewed live with services/quotationTotals.ts, the same functions the
// server recomputes with on save, so what the user sees is what gets stored.
export function QuotationEditor({
  quotation,
  settings,
  defaultGstPct,
  presetCustomer,
  costRates,
  canViewCosting,
}: {
  quotation: QuotationDto | null;
  settings: CompanySettings;
  defaultGstPct: number;
  presetCustomer?: CustomerOption | null;
  /** normName -> automatic cost rate, for the Costing sheet tab. */
  costRates?: Record<string, CostRate>;
  /** Costing is internal margin data — hidden unless the user may see it. */
  canViewCosting?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const isNew = !quotation;
  const converted = quotation?.status === "CONVERTED";

  const [customerId, setCustomerId] = useState<string | null>(quotation?.customerId ?? presetCustomer?.id ?? null);
  const [client, setClient] = useState(quotation?.client ?? presetCustomer?.name ?? "");
  const [billing, setBilling] = useState(quotation?.billing ?? presetCustomer?.billing ?? "");
  const [delivery, setDelivery] = useState(quotation?.delivery ?? presetCustomer?.delivery ?? "");
  const [title, setTitle] = useState(quotation?.title ?? "");
  const [date, setDate] = useState(quotation?.date ?? todayIso());
  const [refBy, setRefBy] = useState(quotation?.refBy ?? presetCustomer?.refBy ?? "");
  const [salesPerson, setSalesPerson] = useState(quotation?.salesPerson ?? presetCustomer?.salesPerson ?? "");
  const [status, setStatus] = useState(quotation?.status ?? "DRAFT");
  const [validityDays, setValidityDays] = useState(String(quotation?.validityDays ?? 30));

  const [discountPct, setDiscountPct] = useState(String(quotation?.discountPct ?? 0));
  const [installMode, setInstallMode] = useState(quotation?.installMode ?? "INCLUDED");
  const [installBasis, setInstallBasis] = useState(quotation?.installBasis ?? "PERCENT");
  const [installValue, setInstallValue] = useState(String(quotation?.installValue ?? 0));
  const [transportMode, setTransportMode] = useState(quotation?.transportMode ?? "INCLUDED");
  const [transportAmount, setTransportAmount] = useState(String(quotation?.transportAmount ?? 0));
  const [gstMode, setGstMode] = useState(quotation?.gstMode ?? "EXTRA");
  const [gstPct, setGstPct] = useState(String(quotation?.gstPct ?? defaultGstPct));
  const [roundTo, setRoundTo] = useState(quotation?.roundTo != null ? String(quotation.roundTo) : "");
  const [note, setNote] = useState(quotation?.note ?? "");
  const [terms, setTerms] = useState(quotation?.terms ?? QUOTE_DEFAULT_TERMS);
  const [showDetails, setShowDetails] = useState(quotation?.showDetails ?? false);
  const [areaTotalsWithGst, setAreaTotalsWithGst] = useState(quotation?.areaTotalsWithGst ?? false);
  const [sections, setSections] = useState<string[]>(quotation?.sections ?? []);
  const [newSection, setNewSection] = useState("");
  const [lines, setLines] = useState<LineDraft[]>(toDrafts(quotation));

  const [dirty, setDirty] = useState(false);
  // Ported from the prototype's view.qtab: the quotation itself, or the
  // internal costing sheet. Only meaningful once the quote has been saved.
  const [qtab, setQtab] = useState<"quote" | "costing">("quote");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pickingCustomer, setPickingCustomer] = useState(false);
  const [pickingItemFor, setPickingItemFor] = useState<string | null>(null);
  const [editingMakesFor, setEditingMakesFor] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "convert" | "delete" | "archive">(null);
  const { target: printTarget, printArea, print } = usePrintPortal<QuotationDto>();

  const touch = () => setDirty(true);

  const quoteTermsValue: QuoteTerms = useMemo(
    () => ({
      discountPct: num(discountPct),
      installMode: installMode as "INCLUDED" | "EXTRA",
      installBasis: installBasis as "PERCENT" | "LUMPSUM" | "PER_UNIT",
      installValue: num(installValue),
      transportMode: transportMode as "INCLUDED" | "EXTRA",
      transportAmount: num(transportAmount),
      gstMode: gstMode as "INCLUDED" | "EXTRA",
      gstPct: num(gstPct),
      roundTo: roundTo.trim() === "" ? null : num(roundTo),
      areaTotalsWithGst,
    }),
    [discountPct, installMode, installBasis, installValue, transportMode, transportAmount, gstMode, gstPct, roundTo, areaTotalsWithGst]
  );

  const quoteLines = useMemo(
    () =>
      lines.map((l) => ({
        section: l.section,
        qty: num(l.qty),
        rate: num(l.rate),
        discPct: l.discPct.trim() === "" ? null : num(l.discPct),
      })),
    [lines]
  );

  const totals = useMemo(() => quoteTotals(quoteTermsValue, quoteLines), [quoteTermsValue, quoteLines]);
  const areaNames = useMemo(() => quoteSections(sections, quoteLines), [sections, quoteLines]);

  const setLine = (key: string, patch: Partial<LineDraft>) => {
    setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    touch();
  };

  const addLine = (section = "") => {
    setLines((rows) => [
      ...rows,
      { key: newKey(), catalogItemId: null, section, description: "", makes: [], unit: "Nos", qty: "1", rate: "0", discPct: "" },
    ]);
    touch();
  };

  const buildPayload = () => ({
    customerId,
    client,
    title,
    date,
    billing,
    delivery,
    refBy,
    salesPerson,
    status,
    validityDays: num(validityDays),
    discountPct: num(discountPct),
    installMode,
    installBasis,
    installValue: num(installValue),
    transportMode,
    transportAmount: num(transportAmount),
    gstMode,
    gstPct: num(gstPct),
    roundTo: roundTo.trim() === "" ? null : num(roundTo),
    note,
    terms,
    showDetails,
    areaTotalsWithGst,
    sections,
    items: lines
      .filter((l) => l.description.trim())
      .map((l) => ({
        catalogItemId: l.catalogItemId,
        section: l.section,
        description: l.description,
        makes: l.makes,
        unit: l.unit || "Nos",
        qty: num(l.qty),
        rate: num(l.rate),
        discPct: l.discPct.trim() === "" ? null : num(l.discPct),
      })),
  });

  const save = async () => {
    if (saving) return; // prevents a double-click creating two quotations
    if (!client.trim()) {
      setError("Choose a customer first.");
      return;
    }
    if (!title.trim()) {
      setError("Project title is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = buildPayload();
      const res = await apiFetch<{ quotation: QuotationDto }>(
        isNew ? "/api/quotations" : `/api/quotations/${quotation!.id}`,
        { method: isNew ? "POST" : "PATCH", body: JSON.stringify(payload) }
      );
      setDirty(false);
      toast(isNew ? `Quotation ${res.quotation.ref} created` : "Quotation saved");
      if (isNew) router.push(`/quotations/${res.quotation.id}`);
      else router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server — nothing was saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const doConvert = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch<{ projectId: string }>(`/api/quotations/${quotation!.id}/convert`, { method: "POST" });
      toast("Project created from this quotation");
      router.push(`/projects/${res.projectId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setSaving(false);
      setConfirm(null);
    }
  };

  const doDuplicate = async () => {
    setSaving(true);
    try {
      const res = await apiFetch<{ quotation: QuotationDto }>(`/api/quotations/${quotation!.id}/duplicate`, {
        method: "POST",
      });
      toast(`Duplicated as ${res.quotation.ref}`);
      router.push(`/quotations/${res.quotation.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    setSaving(true);
    try {
      await apiFetch(`/api/quotations/${quotation!.id}`, { method: "DELETE" });
      toast("Quotation deleted");
      router.push("/quotations");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setSaving(false);
      setConfirm(null);
    }
  };

  // Printing needs the SAVED document, not the in-progress draft, so the paper
  // copy can never show numbers that aren't in the database.
  const doPrint = () => {
    if (!quotation) return;
    if (dirty) {
      toast("Save your changes first — printing uses the saved quotation.");
      return;
    }
    print(quotation);
  };

  const fillListPrices = async () => {
    let filled = 0;
    for (const l of lines) {
      if (!l.catalogItemId) continue;
      try {
        const res = await fetch(`/api/catalog/${l.catalogItemId}`);
        if (!res.ok) continue;
        const { item } = await res.json();
        if (item?.sellPrice != null) {
          setLine(l.key, { rate: String(item.sellPrice), discPct: item.discountPct ? String(item.discountPct) : "" });
          filled += 1;
        }
      } catch {
        // A failed lookup just leaves that line's rate alone.
      }
    }
    toast(filled ? `${filled} list price(s) refreshed from the item sheet` : "No linked item had a list price to pull");
  };

  const grouped = areaNames.length > 0;
  const order = grouped ? [...areaNames, ""] : [""];

  // The costing sheet keys its overrides off saved line ids, so it only exists
  // once the quotation has been saved — and only for users allowed to see what
  // the company pays.
  const showTabs = !isNew && !!canViewCosting;

  if (showTabs && qtab === "costing") {
    return (
      <>
        <BackLink href="/quotations">All quotations</BackLink>
        <Tabs tabs={QUOTE_TABS} active={qtab} onChange={setQtab} />
        <QuoteCostingTab quotation={quotation!} costRates={costRates ?? {}} />
      </>
    );
  }

  return (
    <>
      <BackLink href="/quotations">All quotations</BackLink>
      {showTabs && <Tabs tabs={QUOTE_TABS} active={qtab} onChange={setQtab} />}

      <div className={styles.editorHead}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800 }}>
            {isNew ? "New quotation" : `Quotation ${quotation!.ref}`}{" "}
            {!isNew && <Chip tone={STATUS_TONE[quotation!.status] ?? "grey"}>{QUOTATION_STATUS_LABEL[quotation!.status]}</Chip>}
          </h2>
          {!isNew && quotation!.convertedProjectId && (
            <div style={{ fontSize: 13, marginTop: 4 }}>
              Converted to project —{" "}
              <Link href={`/projects/${quotation!.convertedProjectId}`}>open the project</Link>
            </div>
          )}
          {dirty && <div className={styles.dirty}>Unsaved changes</div>}
        </div>
        <div className={styles.editorActions}>
          {!isNew && !converted && (
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                touch();
              }}
              aria-label="Quotation status"
              style={{ width: "auto" }}
            >
              {SELECTABLE_QUOTATION_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {QUOTATION_STATUS_LABEL[st]}
                </option>
              ))}
            </Select>
          )}
          {!isNew && (
            <>
              <Button size="sm" onClick={doPrint} disabled={saving}>
                Print
              </Button>
              <Button size="sm" onClick={doDuplicate} disabled={saving}>
                Duplicate
              </Button>
            </>
          )}
          {!isNew && !converted && (
            <>
              <Button size="sm" variant="primary" onClick={() => setConfirm("convert")} disabled={saving || dirty}>
                Convert to project
              </Button>
              <Button size="sm" variant="danger" onClick={() => setConfirm("delete")} disabled={saving}>
                Delete
              </Button>
            </>
          )}
          {!converted && (
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : isNew ? "Create quotation" : "Save"}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" style={{ color: "var(--danger)", fontSize: 13, marginTop: 10 }}>
          {error}
        </p>
      )}
      {converted && (
        <p style={{ fontSize: 13, marginTop: 10, color: "var(--muted)" }}>
          This quotation has been converted into a project and is locked. Use <b>Duplicate</b> to make a revised version.
        </p>
      )}

      <Card style={{ marginTop: 16 }}>
        <CardHeader>
          <CardTitle>Customer &amp; project</CardTitle>
        </CardHeader>
        <CardBody>
          <FormRow>
            <FormField label="Customer *">
              <div style={{ display: "flex", gap: 6 }}>
                <TextInput
                  value={client}
                  readOnly
                  onClick={() => !converted && setPickingCustomer(true)}
                  placeholder="click to choose"
                  style={{ background: "#FAFBFB", cursor: converted ? "default" : "pointer" }}
                />
                {!converted && (
                  <Button size="sm" type="button" onClick={() => setPickingCustomer(true)}>
                    Choose
                  </Button>
                )}
              </div>
            </FormField>
            <FormField label="Quotation date">
              <TextInput
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  touch();
                }}
                disabled={converted}
              />
            </FormField>
            <FormField label="Validity (days)">
              <TextInput
                type="number"
                min={0}
                value={validityDays}
                onChange={(e) => {
                  setValidityDays(e.target.value);
                  touch();
                }}
                disabled={converted}
              />
            </FormField>
          </FormRow>
          <FormField label="Project title *">
            <TextInput
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                touch();
              }}
              placeholder="e.g. Swimming Pool & Water Body at Vasant Vihar residence"
              disabled={converted}
            />
          </FormField>
          <FormRow>
            <FormField label="Referred by">
              <TextInput
                value={refBy}
                onChange={(e) => {
                  setRefBy(e.target.value);
                  touch();
                }}
                disabled={converted}
              />
            </FormField>
            <FormField label="Sales person">
              <TextInput
                value={salesPerson}
                onChange={(e) => {
                  setSalesPerson(e.target.value);
                  touch();
                }}
                disabled={converted}
              />
            </FormField>
          </FormRow>
          <FormRow>
            <FormField label="Billing address">
              <Textarea
                rows={2}
                value={billing}
                onChange={(e) => {
                  setBilling(e.target.value);
                  touch();
                }}
                disabled={converted}
              />
            </FormField>
            <FormField label="Site / delivery address">
              <Textarea
                rows={2}
                value={delivery}
                onChange={(e) => {
                  setDelivery(e.target.value);
                  touch();
                }}
                disabled={converted}
              />
            </FormField>
          </FormRow>
        </CardBody>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <CardHeader>
          <CardTitle>Items</CardTitle>
          {!converted && (
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button size="sm" onClick={() => void fillListPrices()}>
                Refresh list prices
              </Button>
              <Button size="sm" variant="primary" onClick={() => addLine()}>
                <Plus size={14} /> Add item
              </Button>
            </div>
          )}
        </CardHeader>
        <CardBody>
          {!converted && (
            <div style={{ marginBottom: 12 }}>
              <FormRow style={{ alignItems: "end" }}>
                <FormField label="Areas / sub-headings (e.g. Bathroom A, Kitchen)">
                  <TextInput
                    value={newSection}
                    onChange={(e) => setNewSection(e.target.value)}
                    placeholder="Type an area name and press Add"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const v = newSection.trim();
                        if (!v) return;
                        if (sections.includes(v)) {
                          toast("That area already exists");
                          return;
                        }
                        setSections((s) => [...s, v]);
                        setNewSection("");
                        touch();
                      }
                    }}
                  />
                </FormField>
                <Button
                  size="sm"
                  onClick={() => {
                    const v = newSection.trim();
                    if (!v) {
                      toast("Type an area name first");
                      return;
                    }
                    if (sections.includes(v)) {
                      toast("That area already exists");
                      return;
                    }
                    setSections((s) => [...s, v]);
                    setNewSection("");
                    touch();
                  }}
                >
                  + Add area
                </Button>
              </FormRow>
              <div className={styles.sectionChips}>
                {areaNames.length === 0 && (
                  <span style={{ color: "var(--muted)", fontSize: 12.5 }}>
                    No areas yet — items print as a single table. Add areas to split the quote by room or zone.
                  </span>
                )}
                {areaNames.map((name) => (
                  <span key={name} className={styles.sectionChip}>
                    {name} · {inr(quoteSectionNet(quoteTermsValue, quoteLines, name))}
                    <button
                      type="button"
                      aria-label={`Remove area ${name}`}
                      title="Remove area (its items become ungrouped)"
                      onClick={() => {
                        setSections((s) => s.filter((x) => x !== name));
                        setLines((rows) => rows.map((r) => (r.section === name ? { ...r, section: "" } : r)));
                        touch();
                      }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Particulars</Th>
                  <Th>Make</Th>
                  <Th>Unit</Th>
                  <Th align="r">Qty</Th>
                  <Th align="r">List rate</Th>
                  <Th align="r">Disc %</Th>
                  <Th align="r">Net rate</Th>
                  <Th align="r">Net amount</Th>
                  <Th>Area</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr>
                    <Td colSpan={10} style={{ color: "var(--muted)" }}>
                      No items yet. Click <b>Add item</b> and pick a product from the Item Sheet.
                    </Td>
                  </tr>
                )}
                {order.map((sec) => {
                  const its = lines.filter((l) => (l.section || "").trim() === sec);
                  if (!its.length) return null;
                  return (
                    <Fragment key={`sec-${sec}`}>
                      {grouped && (
                        <tr className={styles.groupRow}>
                          <Td colSpan={10}>
                            {sec || "Other items"}
                            {!converted && (
                              <Button size="sm" style={{ marginLeft: 8 }} onClick={() => addLine(sec)}>
                                + Add item here
                              </Button>
                            )}
                          </Td>
                        </tr>
                      )}
                      {its.map((l) => {
                        const line = {
                          qty: num(l.qty),
                          rate: num(l.rate),
                          discPct: l.discPct.trim() === "" ? null : num(l.discPct),
                        };
                        return (
                          <tr key={l.key}>
                            <Td>
                              <div style={{ display: "flex", gap: 6 }}>
                                <TextInput
                                  value={l.description}
                                  readOnly
                                  onClick={() => !converted && setPickingItemFor(l.key)}
                                  placeholder="choose from item sheet"
                                  style={{ background: "#FAFBFB", cursor: converted ? "default" : "pointer" }}
                                />
                                {!converted && (
                                  <Button size="sm" onClick={() => setPickingItemFor(l.key)} aria-label="Choose item">
                                    …
                                  </Button>
                                )}
                              </div>
                            </Td>
                            <Td>
                              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                <span style={{ fontSize: 12 }}>
                                  {l.makes.length ? l.makes.join(" / ") : <span style={{ color: "var(--warn)" }}>select</span>}
                                </span>
                                {!converted && (
                                  <Button size="sm" onClick={() => setEditingMakesFor(l.key)} aria-label="Choose makes">
                                    …
                                  </Button>
                                )}
                              </div>
                            </Td>
                            <Td>
                              <TextInput
                                className={styles.unit}
                                value={l.unit}
                                onChange={(e) => setLine(l.key, { unit: e.target.value })}
                                disabled={converted}
                              />
                            </Td>
                            <Td align="r">
                              <TextInput
                                className={styles.qty}
                                type="number"
                                min={0}
                                value={l.qty}
                                onChange={(e) => setLine(l.key, { qty: e.target.value })}
                                disabled={converted}
                              />
                            </Td>
                            <Td align="r">
                              <TextInput
                                className={styles.rate}
                                type="number"
                                min={0}
                                value={l.rate}
                                onChange={(e) => setLine(l.key, { rate: e.target.value })}
                                disabled={converted}
                              />
                            </Td>
                            <Td align="r">
                              <TextInput
                                className={styles.disc}
                                type="number"
                                min={0}
                                max={100}
                                value={l.discPct}
                                placeholder={discountPct}
                                title="Leave blank to use the quotation's default discount"
                                onChange={(e) => setLine(l.key, { discPct: e.target.value })}
                                disabled={converted}
                              />
                            </Td>
                            <Td align="r">{inr(lineNetRate(quoteTermsValue, line))}</Td>
                            <Td align="r">{inr(lineNet(quoteTermsValue, line))}</Td>
                            <Td>
                              <Select
                                value={l.section}
                                onChange={(e) => setLine(l.key, { section: e.target.value })}
                                style={{ width: "auto", fontSize: 12 }}
                                aria-label="Area"
                                disabled={converted}
                              >
                                <option value="">— none —</option>
                                {areaNames.map((x) => (
                                  <option key={x} value={x}>
                                    {x}
                                  </option>
                                ))}
                              </Select>
                            </Td>
                            <Td>
                              {!converted && (
                                <Button
                                  size="sm"
                                  variant="danger"
                                  aria-label={`Remove ${l.description || "item"}`}
                                  onClick={() => {
                                    setLines((rows) => rows.filter((r) => r.key !== l.key));
                                    touch();
                                  }}
                                >
                                  <Trash2 size={14} />
                                </Button>
                              )}
                            </Td>
                          </tr>
                        );
                      })}
                      {grouped && (
                        <tr className={styles.subtotalRow}>
                          <Td colSpan={7} align="r">
                            Sub-total — {sec || "Other items"} (after discount)
                          </Td>
                          <Td align="r">{inr(quoteSectionNet(quoteTermsValue, quoteLines, sec))}</Td>
                          <Td colSpan={2} />
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        </CardBody>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <CardHeader>
          <CardTitle>Commercial terms</CardTitle>
        </CardHeader>
        <CardBody>
          <FormRow>
            <FormField label="Default discount % (lines with a blank Disc % use this)">
              <TextInput
                type="number"
                min={0}
                max={100}
                value={discountPct}
                onChange={(e) => {
                  setDiscountPct(e.target.value);
                  touch();
                }}
                disabled={converted}
              />
            </FormField>
            <FormField label="Round grand total to (₹, optional)">
              <TextInput
                type="number"
                min={0}
                value={roundTo}
                onChange={(e) => {
                  setRoundTo(e.target.value);
                  touch();
                }}
                disabled={converted}
              />
            </FormField>
          </FormRow>
          <FormRow>
            <FormField label="GST">
              <Select
                value={gstMode}
                onChange={(e) => {
                  setGstMode(e.target.value as "INCLUDED" | "EXTRA");
                  touch();
                }}
                disabled={converted}
              >
                <option value="EXTRA">Extra</option>
                <option value="INCLUDED">Included in rates</option>
              </Select>
            </FormField>
            <FormField label="GST %">
              <TextInput
                type="number"
                min={0}
                max={100}
                value={gstPct}
                onChange={(e) => {
                  setGstPct(e.target.value);
                  touch();
                }}
                disabled={converted || gstMode !== "EXTRA"}
              />
            </FormField>
            <FormField label="Transport">
              <Select
                value={transportMode}
                onChange={(e) => {
                  setTransportMode(e.target.value as "INCLUDED" | "EXTRA");
                  touch();
                }}
                disabled={converted}
              >
                <option value="INCLUDED">Included</option>
                <option value="EXTRA">Extra</option>
              </Select>
            </FormField>
            <FormField label="Transport amount (₹)">
              <TextInput
                type="number"
                min={0}
                value={transportAmount}
                onChange={(e) => {
                  setTransportAmount(e.target.value);
                  touch();
                }}
                disabled={converted || transportMode !== "EXTRA"}
              />
            </FormField>
          </FormRow>
          <FormRow>
            <FormField label="Installation">
              <Select
                value={installMode}
                onChange={(e) => {
                  setInstallMode(e.target.value as "INCLUDED" | "EXTRA");
                  touch();
                }}
                disabled={converted}
              >
                <option value="INCLUDED">Included</option>
                <option value="EXTRA">Extra</option>
              </Select>
            </FormField>
            <FormField label="Installation basis">
              <Select
                value={installBasis}
                onChange={(e) => {
                  setInstallBasis(e.target.value as "PERCENT" | "LUMPSUM" | "PER_UNIT");
                  touch();
                }}
                disabled={converted || installMode !== "EXTRA"}
              >
                <option value="PERCENT">Percentage of value</option>
                <option value="LUMPSUM">Lump sum</option>
                <option value="PER_UNIT">Per unit (rate × total qty)</option>
              </Select>
            </FormField>
            <FormField
              label={
                installBasis === "LUMPSUM"
                  ? "Lump sum amount (₹)"
                  : installBasis === "PER_UNIT"
                    ? "Rate per unit (₹)"
                    : "Installation %"
              }
            >
              <TextInput
                type="number"
                min={0}
                value={installValue}
                onChange={(e) => {
                  setInstallValue(e.target.value);
                  touch();
                }}
                disabled={converted || installMode !== "EXTRA"}
              />
            </FormField>
          </FormRow>

          <label style={{ display: "block", marginBottom: 10, fontSize: 13.5 }}>
            <input
              type="checkbox"
              checked={showDetails}
              onChange={(e) => {
                setShowDetails(e.target.checked);
                touch();
              }}
              disabled={converted}
            />{" "}
            Print item specifications from the item sheet under each line
          </label>
          <label style={{ display: "block", marginBottom: 12, fontSize: 13.5 }}>
            <input
              type="checkbox"
              checked={areaTotalsWithGst}
              onChange={(e) => {
                setAreaTotalsWithGst(e.target.checked);
                touch();
              }}
              disabled={converted}
            />{" "}
            Show area-wise totals <b>inclusive of GST</b>
          </label>

          <FormField label="Note (printed on the quotation)">
            <TextInput
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                touch();
              }}
              disabled={converted}
            />
          </FormField>
          <FormField label="Terms and conditions">
            <Textarea
              rows={8}
              value={terms}
              onChange={(e) => {
                setTerms(e.target.value);
                touch();
              }}
              disabled={converted}
            />
          </FormField>
        </CardBody>
      </Card>

      <div className={styles.totalsBar}>
        <span>List {inr(totals.subtotal)}</span>
        {totals.discountAmount > 0 && <span>Less discount −{inr(totals.discountAmount)}</span>}
        <span>Net {inr(totals.netAmount)}</span>
        {totals.installAmount > 0 && <span>Installation +{inr(totals.installAmount)}</span>}
        {!!quoteTermsValue.roundTo && <span>Rounded {inr(totals.roundedAmount)}</span>}
        {totals.transportAmount > 0 && <span>Transport +{inr(totals.transportAmount)}</span>}
        {totals.gstAmount > 0 && (
          <span>
            GST {gstPct}% +{inr(totals.gstAmount)}
          </span>
        )}
        <span className={styles.grand}>
          <b>Total payable: {inr(totals.grandTotal)}</b>
        </span>
      </div>

      {pickingCustomer && (
        <CustomerPicker
          onClose={() => setPickingCustomer(false)}
          onPick={(c) => {
            setCustomerId(c.id);
            setClient(c.name);
            if (!billing) setBilling(c.billing ?? "");
            if (!delivery) setDelivery(c.delivery ?? "");
            if (!refBy) setRefBy(c.refBy ?? "");
            if (!salesPerson) setSalesPerson(c.salesPerson ?? "");
            setPickingCustomer(false);
            touch();
          }}
        />
      )}

      {pickingItemFor && (
        <ItemPicker
          currentName={lines.find((l) => l.key === pickingItemFor)?.description}
          onClose={() => setPickingItemFor(null)}
          onPick={(item: CatalogOption) => {
            setLine(pickingItemFor, {
              catalogItemId: item.id,
              description: item.name,
              unit: item.unit || "Nos",
              makes: item.makes,
              // Quotations always show the LIST rate; the discount is a
              // separate, visible line on the printed document.
              rate: item.sellPrice != null ? String(item.sellPrice) : "0",
              discPct: item.discountPct ? String(item.discountPct) : "",
            });
            setPickingItemFor(null);
          }}
        />
      )}

      {editingMakesFor && (
        <MakesModal
          line={lines.find((l) => l.key === editingMakesFor)!}
          onClose={() => setEditingMakesFor(null)}
          onSave={(makes) => {
            setLine(editingMakesFor, { makes });
            setEditingMakesFor(null);
          }}
        />
      )}

      {confirm === "convert" && (
        <ConfirmModal
          message={`Create a project from this quotation? Line rates carry the discount${quoteTermsValue.roundTo ? " and rounding" : ""} across, installation becomes its own line, and this quotation locks as Converted.`}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void doConvert()}
        />
      )}
      {confirm === "delete" && (
        <ConfirmModal
          message="Delete this quotation permanently? This cannot be undone."
          onCancel={() => setConfirm(null)}
          onConfirm={() => void doDelete()}
        />
      )}

      {printTarget && printArea
        ? createPortal(<QuotationDoc settings={settings} quotation={printTarget} />, printArea)
        : null}
    </>
  );
}

// Small chooser for the approved makes offered on one line. Starts from the
// catalogue item's brand list and allows adding one-off makes.
function MakesModal({
  line,
  onClose,
  onSave,
}: {
  line: LineDraft;
  onClose: () => void;
  onSave: (makes: string[]) => void;
}) {
  const [known, setKnown] = useState<string[]>(line.makes);
  const [selected, setSelected] = useState<string[]>(line.makes);
  const [extra, setExtra] = useState("");
  const [loading, setLoading] = useState(!!line.catalogItemId);

  // Pull the catalogue item's full brand list so the user can tick from
  // everything we can actually supply, not just what's already on the line.
  useEffect(() => {
    if (!line.catalogItemId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/catalog/${line.catalogItemId}`);
        if (!res.ok) return;
        const { item } = await res.json();
        if (!cancelled && item?.makes) setKnown((k) => [...new Set([...k, ...(item.makes as string[])])]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [line.catalogItemId]);

  const toggle = (m: string) =>
    setSelected((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]));

  return (
    <Modal
      title={`Approved makes — ${line.description || "item"}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave(selected)}>
            Save makes
          </Button>
        </>
      }
    >
      <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>
        Tick the make(s) to offer for this line. Any ticked make may be supplied at the quoted rate.
      </p>
      {loading && <p style={{ fontSize: 13 }}>Loading brands…</p>}
      {!loading && known.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--muted)" }}>
          No brands recorded for this item yet — add one below, or set them on the Item Sheet.
        </p>
      )}
      {known.map((m) => (
        <label key={m} style={{ display: "block", margin: "5px 0" }}>
          <input type="checkbox" checked={selected.includes(m)} onChange={() => toggle(m)} /> {m}
        </label>
      ))}
      <FormRow style={{ alignItems: "end", marginTop: 10 }}>
        <FormField label="Add another make">
          <TextInput value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="e.g. Astral" />
        </FormField>
        <Button
          size="sm"
          onClick={() => {
            const v = extra.trim();
            if (!v || known.includes(v)) return;
            setKnown((k) => [...k, v]);
            setSelected((s) => [...s, v]);
            setExtra("");
          }}
        >
          + Add
        </Button>
      </FormRow>
    </Modal>
  );
}
