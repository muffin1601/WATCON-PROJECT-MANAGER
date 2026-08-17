"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "../Modal/Modal";
import { Button } from "../Button/Button";
import { FormField, FormRow } from "../Form/FormField";
import { TextInput, Textarea } from "../Form/Inputs";
import { Segmented } from "../Segmented/Segmented";
import { Table, TableWrap, Td, Th, EmptyState } from "../Table/Table";
import { Chip } from "../Chip/Chip";
import { VendorModal } from "./VendorModal";
import { useToast } from "../Toast/ToastProvider";
import { apiFetch, ApiError } from "../../lib/apiClient";
import { todayIso } from "../../lib/format";
import type { RfqCandidate } from "../../services/rfqService";
import type { VendorDto } from "../../services/vendorService";
import styles from "./Purchase.module.css";

type SortKey = "name" | "make" | "category" | "toOrder";

// Ported from newRfqWizard() → rfqItemsStep() → rfqVendorsStep(): three steps,
// same titles, same controls.
export function NewRfqWizard({
  projects,
  vendors,
  onClose,
}: {
  projects: { id: string; name: string; client: string; site: string | null }[];
  vendors: VendorDto[];
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<RfqCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [hideZero, setHideZero] = useState(true);
  // key -> to-order qty for the ticked rows.
  const [chosen, setChosen] = useState<Map<string, number>>(new Map());

  const [date, setDate] = useState(todayIso());
  const [due, setDue] = useState("");
  const [deliverTo, setDeliverTo] = useState("");
  const [note, setNote] = useState(
    "Please quote your best rates. Mention GST % and transport charges separately. Rates to be valid for 30 days."
  );
  const [vendorList, setVendorList] = useState<VendorDto[]>(vendors);
  const [vendorIds, setVendorIds] = useState<string[]>([]);
  const [addingVendor, setAddingVendor] = useState(false);
  const [busy, setBusy] = useState(false);

  // Step 2 pulls the pending-vs-stock figures for the chosen projects.
  useEffect(() => {
    if (step !== 2 || !projectIds.length) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/rfqs?candidates=${projectIds.join(",")}`);
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load items");
        const data = await res.json();
        if (cancelled) return;
        setCandidates(data.candidates ?? []);
        // Pre-tick everything that actually needs ordering, at its computed qty.
        setChosen(
          new Map((data.candidates as RfqCandidate[]).filter((c) => c.toOrder > 0).map((c) => [c.key, c.toOrder]))
        );
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, projectIds]);

  const shown = candidates
    .filter((c) => !hideZero || c.toOrder > 0)
    .slice()
    .sort((a, b) =>
      sortKey === "toOrder"
        ? b.toOrder - a.toOrder
        : String(a[sortKey] || "").localeCompare(String(b[sortKey] || "")) || a.name.localeCompare(b.name)
    );

  const create = async () => {
    if (busy) return;
    if (!vendorIds.length) {
      setError("Select at least one supplier");
      return;
    }
    const lines = [...chosen.entries()]
      .map(([key, qty]) => {
        const c = candidates.find((x) => x.key === key);
        return c && qty > 0
          ? {
              name: c.name,
              make: c.make,
              unit: c.unit,
              category: c.category,
              required: c.required,
              stock: c.stock,
              qty,
              projectNames: c.projects,
            }
          : null;
      })
      .filter(Boolean);
    if (!lines.length) {
      setError("Select at least one item with a to-order quantity");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const res = await apiFetch<{ rfq: { id: string; no: string } }>("/api/rfqs", {
        method: "POST",
        body: JSON.stringify({ date, due, deliverTo, note, projectIds, lines, vendorIds }),
      });
      toast(`Rate inquiry ${res.rfq.no} created — send each supplier their form`);
      router.push(`/purchase/rfq/${res.rfq.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
      setBusy(false);
    }
  };

  if (addingVendor) {
    return (
      <VendorModal
        onClose={() => setAddingVendor(false)}
        onSaved={(v) => {
          setVendorList((prev) => [...prev, v].sort((a, b) => a.name.localeCompare(b.name)));
          setVendorIds((prev) => [...prev, v.id]);
          setAddingVendor(false);
        }}
      />
    );
  }

  // ---- Step 1: projects ----
  if (step === 1) {
    return (
      <Modal
        title="New rate inquiry — step 1 of 3: select project(s)"
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!projectIds.length) {
                  setError("Select at least one project");
                  return;
                }
                setError("");
                setStep(2);
              }}
            >
              Next: choose items →
            </Button>
          </>
        }
      >
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {projects.length === 0 ? (
          <EmptyState>No active projects.</EmptyState>
        ) : (
          projects.map((p) => (
            <label key={p.id} style={{ display: "block", margin: "6px 0" }}>
              <input
                type="checkbox"
                checked={projectIds.includes(p.id)}
                onChange={(e) =>
                  setProjectIds((prev) => (e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)))
                }
              />{" "}
              <b>{p.name}</b>{" "}
              <span className={styles.note}>
                — {p.client}
                {p.site ? ` · ${p.site}` : ""}
              </span>
            </label>
          ))
        )}
      </Modal>
    );
  }

  // ---- Step 2: items ----
  if (step === 2) {
    return (
      <Modal
        title="New rate inquiry — step 2 of 3: select items"
        onClose={onClose}
        footer={
          <>
            <Button onClick={() => setStep(1)}>← Back</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (![...chosen.values()].some((q) => q > 0)) {
                  setError("Select at least one item with a to-order quantity");
                  return;
                }
                setError("");
                setStep(3);
              }}
            >
              Next: choose suppliers →
            </Button>
          </>
        }
      >
        <div className={styles.wizardBar}>
          <span className={styles.note}>Sort by:</span>
          <Segmented
            options={[
              { value: "name", label: "Item" },
              { value: "make", label: "Make / brand" },
              { value: "category", label: "Type" },
              { value: "toOrder", label: "To-order qty" },
            ]}
            value={sortKey}
            onChange={(v) => setSortKey(v as SortKey)}
          />
          <label style={{ marginLeft: "auto", fontSize: 13 }}>
            <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} /> hide items
            fully in stock
          </label>
          <Button
            size="sm"
            onClick={() => setChosen(new Map(shown.map((c) => [c.key, chosen.get(c.key) ?? c.toOrder])))}
          >
            Select all shown
          </Button>
        </div>

        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <p className={styles.note} style={{ marginBottom: 8 }}>
          Required = pending delivery across the selected projects · In stock = current stock of that item/make · To
          order = required − stock (editable).
        </p>

        {loading ? (
          <p className={styles.note}>Loading items…</p>
        ) : (
          <div className={styles.scrollTable}>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th />
                    <Th>Item</Th>
                    <Th>Make / brand</Th>
                    <Th>Type</Th>
                    <Th>Unit</Th>
                    <Th>For projects</Th>
                    <Th align="r">Required</Th>
                    <Th align="r">In stock</Th>
                    <Th align="r">To order</Th>
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 && (
                    <tr>
                      <Td colSpan={9}>
                        <EmptyState>Nothing to order — everything pending is already in stock.</EmptyState>
                      </Td>
                    </tr>
                  )}
                  {shown.map((c) => {
                    const ticked = chosen.has(c.key);
                    return (
                      <tr key={c.key}>
                        <Td>
                          <input
                            type="checkbox"
                            aria-label={`Include ${c.name}`}
                            checked={ticked}
                            onChange={(e) =>
                              setChosen((prev) => {
                                const next = new Map(prev);
                                if (e.target.checked) next.set(c.key, next.get(c.key) ?? c.toOrder);
                                else next.delete(c.key);
                                return next;
                              })
                            }
                          />
                        </Td>
                        <Td>
                          <b>{c.name}</b>
                        </Td>
                        <Td>{c.make ? <Chip tone="teal">{c.make}</Chip> : "—"}</Td>
                        <Td>{c.category || "—"}</Td>
                        <Td>{c.unit}</Td>
                        <Td className={styles.note}>{c.projects.join(", ")}</Td>
                        <Td align="r">{c.required}</Td>
                        <Td align="r" style={{ color: c.stock > 0 ? "var(--ok)" : undefined }}>
                          {c.stock}
                        </Td>
                        <Td align="r">
                          <TextInput
                            type="number"
                            min={0}
                            className={styles.qtyInput}
                            value={ticked ? chosen.get(c.key) : c.toOrder}
                            onChange={(e) =>
                              setChosen((prev) => {
                                const next = new Map(prev);
                                next.set(c.key, Number(e.target.value) || 0);
                                return next;
                              })
                            }
                          />
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          </div>
        )}
      </Modal>
    );
  }

  // ---- Step 3: suppliers & terms ----
  return (
    <Modal
      title="New rate inquiry — step 3 of 3: suppliers & terms"
      onClose={onClose}
      footer={
        <>
          <Button onClick={() => setStep(2)}>← Back</Button>
          <Button variant="primary" onClick={create} disabled={busy}>
            {busy ? "Creating…" : "Create rate inquiry"}
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <FormRow>
        <FormField label="Inquiry date">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
        <FormField label="Rates required by">
          <TextInput type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </FormField>
        <FormField label="Delivery to">
          <TextInput value={deliverTo} onChange={(e) => setDeliverTo(e.target.value)} />
        </FormField>
      </FormRow>
      <FormField label="Notes / terms to suppliers">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>

      <h4 style={{ fontSize: 13, margin: "6px 0" }}>Send to suppliers</h4>
      {vendorList.length === 0 ? (
        <p className={styles.note}>No suppliers yet.</p>
      ) : (
        vendorList.map((v) => (
          <label key={v.id} style={{ display: "block", margin: "5px 0" }}>
            <input
              type="checkbox"
              checked={vendorIds.includes(v.id)}
              onChange={(e) =>
                setVendorIds((prev) => (e.target.checked ? [...prev, v.id] : prev.filter((x) => x !== v.id)))
              }
            />{" "}
            <b>{v.name}</b> <span className={styles.note}>{[v.contact, v.phone].filter(Boolean).join(" ")}</span>
          </label>
        ))
      )}
      <Button size="sm" style={{ marginTop: 6 }} onClick={() => setAddingVendor(true)}>
        + New supplier
      </Button>
    </Modal>
  );
}
