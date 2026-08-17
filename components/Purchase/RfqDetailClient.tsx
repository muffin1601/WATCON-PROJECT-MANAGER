"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BackLink } from "../BackLink/BackLink";
import { Card, CardBody, CardHeader, CardTitle } from "../Card/Card";
import { Table, TableWrap, Td, Th, EmptyState } from "../Table/Table";
import { Button } from "../Button/Button";
import { Chip, type ChipTone } from "../Chip/Chip";
import { Select } from "../Form/Inputs";
import { ConfirmModal } from "../Modal/ConfirmModal";
import { ManualReplyModal } from "./ManualReplyModal";
import { VendorModal } from "./VendorModal";
import { RfqDoc, RfqCompareDoc } from "../PrintDoc/PurchaseDocs";
import type { CompanySettings } from "../PrintDoc/DocHead";
import { useToast } from "../Toast/ToastProvider";
import { usePrintPortal } from "../../hooks/usePrintPortal";
import { apiFetch, ApiError } from "../../lib/apiClient";
import { inr, dfmt } from "../../lib/format";
import { buildSupplierFormHtml, downloadText, supplierFormFileName } from "./supplierForm";
import type { RfqDetail } from "../../services/rfqService";
import type { VendorDto } from "../../services/vendorService";
import styles from "./Purchase.module.css";

const RFQ_STATUS_LABEL: Record<string, string> = { SENT: "Sent", COMPARING: "Comparing", PO_ISSUED: "PO issued" };
const RFQ_TONE: Record<string, ChipTone> = { SENT: "grey", COMPARING: "teal", PO_ISSUED: "green" };

type PrintTarget = { kind: "rfq" } | { kind: "compare" };

// Ported from renderRfq() — the same four numbered sections.
export function RfqDetailClient({
  rfq,
  settings,
  allVendors,
}: {
  rfq: RfqDetail;
  settings: CompanySettings;
  allVendors: VendorDto[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const [addingVendor, setAddingVendor] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ vendorId: string; name: string } | null>(null);
  const [importLog, setImportLog] = useState<{ name: string; ok: boolean; message: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { target: printTarget, printArea, print } = usePrintPortal<PrintTarget>();

  const vendorName = (id: string) => rfq.vendors.find((v) => v.id === id)?.name ?? "?";
  const respondedIds = Object.keys(rfq.totals);
  const bestTotalVid = respondedIds.length
    ? respondedIds.reduce((a, b) => (rfq.totals[b]!.total < rfq.totals[a]!.total ? b : a))
    : null;

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  // ---- Reply import (ported from importRfqReplies) ----
  const importFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    const log: typeof importLog = [];
    for (const f of files) {
      try {
        const text = await f.text();
        const file = JSON.parse(text);
        const res = await apiFetch<{ vendorId: string; matched: number }>(`/api/rfqs/${rfq.id}/responses`, {
          method: "POST",
          body: JSON.stringify({ action: "import", file }),
        });
        log.push({ name: f.name, ok: true, message: `imported — ${res.matched} item(s) quoted` });
      } catch (err) {
        log.push({
          name: f.name,
          ok: false,
          message: err instanceof ApiError ? err.message : "Not a readable reply file",
        });
      }
    }
    setImportLog(log);
    setBusy(false);
    const okCount = log.filter((l) => l.ok).length;
    toast(`${okCount} reply file(s) imported${log.length - okCount ? `, ${log.length - okCount} failed` : ""}`);
    router.refresh();
  };

  // Group chosen lines by supplier for section 4.
  const bySupplier = new Map<string, typeof rfq.rows>();
  rfq.rows.forEach((r) => {
    if (!r.chosen) return;
    const list = bySupplier.get(r.chosen) ?? [];
    list.push(r);
    bySupplier.set(r.chosen, list);
  });

  return (
    <>
      <BackLink href="/purchase">Purchase</BackLink>

      <div className={styles.head}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h2>
            Rate Inquiry {rfq.no} <Chip tone={RFQ_TONE[rfq.status] ?? "grey"}>{RFQ_STATUS_LABEL[rfq.status]}</Chip>
          </h2>
          <div className={styles.note} style={{ marginTop: 4 }}>
            {dfmt(rfq.date)}
            {rfq.due ? ` · rates by ${dfmt(rfq.due)}` : ""} · Projects: {rfq.projectNames.join(", ")} ·{" "}
            {rfq.lineCount} items
          </div>
        </div>
        <Button size="sm" onClick={() => print({ kind: "rfq" })}>
          Print inquiry
        </Button>
      </div>

      {/* 1. Send forms */}
      <Card style={{ marginTop: 16 }}>
        <CardHeader>
          <CardTitle>1. Send forms to suppliers</CardTitle>
          <Button size="sm" style={{ marginLeft: "auto" }} onClick={() => setAddingVendor(true)}>
            + Add supplier to this inquiry
          </Button>
        </CardHeader>
        <CardBody>
          <p className={styles.note} style={{ marginBottom: 10 }}>
            Each supplier gets a self-contained form (works on phone or PC). They fill rates, GST %, transport and
            download a small reply file, which they send back on WhatsApp / email. Drop that file in step 2.
          </p>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Supplier</Th>
                  <Th>Contact</Th>
                  <Th>Form</Th>
                  <Th>Reply</Th>
                </tr>
              </thead>
              <tbody>
                {rfq.vendors.map((v) => {
                  const resp = rfq.responses[v.id];
                  return (
                    <tr key={v.id}>
                      <Td>
                        <b>{v.name}</b>
                      </Td>
                      <Td>{[v.contact, v.phone].filter(Boolean).join(" ") || "—"}</Td>
                      <Td>
                        <Button
                          size="sm"
                          onClick={() => {
                            downloadText(
                              supplierFormFileName(rfq.no, v.name),
                              buildSupplierFormHtml(rfq, v, settings, dfmt)
                            );
                            toast(`Form downloaded — send it to ${v.name}`);
                          }}
                        >
                          Download form
                        </Button>{" "}
                        <Button
                          size="sm"
                          onClick={() => {
                            const win = window.open("", "_blank");
                            if (!win) {
                              toast("Pop-up blocked — use Download form");
                              return;
                            }
                            win.document.write(buildSupplierFormHtml(rfq, v, settings, dfmt));
                            win.document.close();
                          }}
                        >
                          Open
                        </Button>
                      </Td>
                      <Td>
                        {resp ? (
                          <>
                            <Chip tone="green">received</Chip>{" "}
                            <span className={styles.note}>
                              {resp.quotedBy}
                              {resp.filledAt ? ` · ${dfmt(resp.filledAt.slice(0, 10))}` : ""} ·{" "}
                              {rfq.totals[v.id]?.quoted ?? 0}/{rfq.lineCount} items
                            </span>{" "}
                            <Button
                              size="sm"
                              variant="danger"
                              aria-label={`Remove ${v.name}'s reply`}
                              onClick={() => setConfirmRemove({ vendorId: v.id, name: v.name })}
                            >
                              ✕
                            </Button>
                          </>
                        ) : (
                          <Chip tone="gold">awaiting</Chip>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        </CardBody>
      </Card>

      {/* 2. Receive replies */}
      <Card style={{ marginTop: 16 }}>
        <CardHeader>
          <CardTitle>2. Receive supplier replies</CardTitle>
        </CardHeader>
        <CardBody>
          <div
            className={[styles.drop, dragOver ? styles.over : ""].filter(Boolean).join(" ")}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void importFiles([...e.dataTransfer.files]);
            }}
          >
            Drop supplier reply files here (one or many .json), or click to choose
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            multiple
            style={{ display: "none" }}
            onChange={(e) => void importFiles([...(e.target.files ?? [])])}
          />
          <p className={styles.note} style={{ marginTop: 8 }}>
            Or{" "}
            <Button size="sm" onClick={() => setManual(true)}>
              enter a supplier&apos;s rates manually
            </Button>{" "}
            (from a phone call / paper quote).
          </p>
          {importLog.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {importLog.map((l, i) => (
                <div key={i} className={styles.group}>
                  <b>{l.name}</b>{" "}
                  <Chip tone={l.ok ? "green" : "red"}>{l.message}</Chip>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* 3. Comparison */}
      <Card style={{ marginTop: 16 }}>
        <CardHeader>
          <CardTitle>3. Comparison sheet</CardTitle>
          {respondedIds.length > 0 && (
            <div className={styles.toolbar}>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const res = await apiFetch<{ count: number }>(`/api/rfqs/${rfq.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ action: "selectLowest" }),
                    });
                    toast(`Lowest supplier selected for ${res.count} item(s)`);
                    router.refresh();
                  })
                }
              >
                Select lowest for all
              </Button>
              <Button size="sm" onClick={() => print({ kind: "compare" })}>
                Print comparison
              </Button>
            </div>
          )}
        </CardHeader>
        <CardBody>
          {respondedIds.length === 0 ? (
            <EmptyState>The comparison appears here once at least one supplier reply is received.</EmptyState>
          ) : (
            <>
              <TableWrap>
                <Table>
                  <thead>
                    <tr>
                      <Th>Item</Th>
                      <Th>Make</Th>
                      <Th align="r">Qty</Th>
                      {respondedIds.map((vid) => (
                        <Th key={vid} align="r" style={vid === bestTotalVid ? { color: "var(--ok)" } : undefined}>
                          {vendorName(vid)}
                          <div className={styles.sub} style={{ fontWeight: 400, textTransform: "none" }}>
                            rate · GST% · landed
                          </div>
                        </Th>
                      ))}
                      <Th>Choose supplier</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rfq.rows.map((row) => (
                      <tr key={row.lineId}>
                        <Td>
                          <b>{row.name}</b>
                          <div className={styles.sub}>{row.projectNames.join(", ")}</div>
                        </Td>
                        <Td>{row.make || "—"}</Td>
                        <Td align="r">
                          {row.qty} {row.unit}
                        </Td>
                        {respondedIds.map((vid) => {
                          const o = row.offers.find((x) => x.vendorId === vid);
                          if (!o || o.rate === null)
                            return (
                              <Td key={vid} align="r" className={styles.note}>
                                not quoted
                              </Td>
                            );
                          return (
                            <Td key={vid} align="r" className={vid === row.best ? styles.best : undefined}>
                              {inr(o.rate)}
                              <div className={styles.sub}>
                                {o.gst}% · {inr(o.landed)}
                                {o.remark ? (
                                  <>
                                    <br />
                                    {o.remark}
                                  </>
                                ) : null}
                              </div>
                            </Td>
                          );
                        })}
                        <Td>
                          <Select
                            style={{ width: "auto" }}
                            aria-label={`Choose supplier for ${row.name}`}
                            value={row.chosen ?? ""}
                            disabled={busy}
                            onChange={(e) =>
                              run(async () => {
                                await apiFetch(`/api/rfqs/${rfq.id}`, {
                                  method: "PATCH",
                                  body: JSON.stringify({
                                    action: "select",
                                    lineId: row.lineId,
                                    vendorId: e.target.value || null,
                                  }),
                                });
                                router.refresh();
                              })
                            }
                          >
                            <option value="">—</option>
                            {row.offers
                              .filter((o) => o.rate !== null)
                              .map((o) => (
                                <option key={o.vendorId} value={o.vendorId}>
                                  {vendorName(o.vendorId)}
                                  {o.vendorId === row.best ? " (lowest)" : ""}
                                </option>
                              ))}
                          </Select>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <Td colSpan={3} align="r">
                        Basic total (quoted items)
                      </Td>
                      {respondedIds.map((vid) => (
                        <Td key={vid} align="r">
                          {inr(rfq.totals[vid]!.basic)}
                        </Td>
                      ))}
                      <Td />
                    </tr>
                    <tr>
                      <Td colSpan={3} align="r">
                        GST
                      </Td>
                      {respondedIds.map((vid) => (
                        <Td key={vid} align="r">
                          {inr(rfq.totals[vid]!.gst)}
                        </Td>
                      ))}
                      <Td />
                    </tr>
                    <tr>
                      <Td colSpan={3} align="r">
                        Transport (+GST)
                      </Td>
                      {respondedIds.map((vid) => (
                        <Td key={vid} align="r">
                          {inr(rfq.totals[vid]!.transport + rfq.totals[vid]!.transportGst)}
                          {rfq.responses[vid]?.transportNote && (
                            <div className={styles.sub}>{rfq.responses[vid]!.transportNote}</div>
                          )}
                        </Td>
                      ))}
                      <Td />
                    </tr>
                    <tr>
                      <Td colSpan={3} align="r">
                        <b>Grand total (landed)</b>
                      </Td>
                      {respondedIds.map((vid) => (
                        <Td key={vid} align="r" style={vid === bestTotalVid ? { color: "var(--ok)" } : undefined}>
                          <b>{inr(rfq.totals[vid]!.total)}</b>
                          <div className={styles.sub}>
                            {rfq.totals[vid]!.quoted}/{rfq.lineCount} items
                            {rfq.responses[vid]?.delivery ? ` · ${rfq.responses[vid]!.delivery}` : ""}
                            {rfq.responses[vid]?.payment ? ` · ${rfq.responses[vid]!.payment}` : ""}
                          </div>
                        </Td>
                      ))}
                      <Td />
                    </tr>
                  </tfoot>
                </Table>
              </TableWrap>
              <p className={styles.note} style={{ marginTop: 8 }}>
                Green cell = lowest landed rate (rate + GST) for that item. Grand totals compare only what each supplier
                quoted — check the item count.
              </p>
            </>
          )}
        </CardBody>
      </Card>

      {/* 4. Issue POs */}
      <Card style={{ marginTop: 16 }}>
        <CardHeader>
          <CardTitle>4. Issue purchase orders</CardTitle>
        </CardHeader>
        <CardBody>
          {bySupplier.size === 0 ? (
            <p className={styles.note}>
              Choose a supplier per item in the comparison sheet, then issue POs here — one PO per supplier.
            </p>
          ) : (
            [...bySupplier.entries()].map(([vid, rows]) => {
              const basic = rows.reduce((t, r) => {
                const o = r.offers.find((x) => x.vendorId === vid);
                return t + r.qty * (o?.rate ?? 0);
              }, 0);
              const already = rfq.posByVendor[vid];
              return (
                <div key={vid} className={styles.group}>
                  <div className={styles.groupRow}>
                    <div>
                      <b>{vendorName(vid)}</b> — {rows.length} item(s) · basic {inr(basic)}
                    </div>
                    {already ? (
                      <div>
                        <Chip tone="green">PO {already.poNumber} issued</Chip>{" "}
                        <Link href={`/purchase/po/${already.id}`}>
                          <Button size="sm">Open PO</Button>
                        </Link>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const res = await apiFetch<{ po: { id: string; poNumber: string } }>(
                              `/api/rfqs/${rfq.id}/issue-po`,
                              { method: "POST", body: JSON.stringify({ vendorId: vid }) }
                            );
                            toast(`PO ${res.po.poNumber} issued to ${vendorName(vid)}`);
                            router.push(`/purchase/po/${res.po.id}`);
                          })
                        }
                      >
                        Issue PO to {vendorName(vid)}
                      </Button>
                    )}
                  </div>
                  <div className={styles.sub} style={{ marginTop: 4 }}>
                    {rows.map((r) => `${r.name} × ${r.qty}`).join(" · ")}
                  </div>
                </div>
              );
            })
          )}
        </CardBody>
      </Card>

      {manual && (
        <ManualReplyModal
          rfq={rfq}
          onClose={() => setManual(false)}
          onSaved={() => {
            setManual(false);
            router.refresh();
          }}
        />
      )}

      {addingVendor && (
        <VendorModal
          onClose={() => setAddingVendor(false)}
          onSaved={(v) =>
            void run(async () => {
              await apiFetch(`/api/rfqs/${rfq.id}`, {
                method: "PATCH",
                body: JSON.stringify({ action: "addVendors", vendorIds: [v.id] }),
              });
              setAddingVendor(false);
              router.refresh();
            })
          }
        />
      )}

      {confirmRemove && (
        <ConfirmModal
          message={`Remove ${confirmRemove.name}'s reply? Their rates will be dropped from the comparison.`}
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() =>
            void run(async () => {
              await apiFetch(`/api/rfqs/${rfq.id}/responses?vendorId=${confirmRemove.vendorId}`, {
                method: "DELETE",
              });
              setConfirmRemove(null);
              toast("Reply removed");
              router.refresh();
            })
          }
        />
      )}

      {printTarget && printArea
        ? createPortal(
            printTarget.kind === "rfq" ? (
              <RfqDoc settings={settings} rfq={rfq} />
            ) : (
              <RfqCompareDoc settings={settings} rfq={rfq} />
            ),
            printArea
          )
        : null}
    </>
  );
}
