import { toNum } from "../../lib/decimal";
import { getPublicUrl } from "../../services/documentService";
import {
  amendTotal,
  billedTotal,
  challanValue,
  computeDispatchBalances,
  contractValue,
  discountTotal,
  dispatchedQty,
  dispatchedValue,
  extraQtyOf,
  gstOn,
  orderBase,
  paidTotal,
  siteAccountFigures,
  transportTotal,
} from "../../services/financials";
import { getProjectDetail, toFinProject } from "./data";

interface DocRow {
  id: string;
  kind: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  uploadedAt: Date;
}

function mapDoc(d: DocRow) {
  return {
    id: d.id,
    kind: d.kind,
    fileName: d.fileName,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    uploadedAt: d.uploadedAt.toISOString().slice(0, 10),
    url: getPublicUrl(d.storagePath),
  };
}

export type ProjectDetail = NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>;

// Serializes a Prisma Project (Decimal/Date fields) into a plain-JSON shape
// safe to pass from a Server Component into Client Components, plus the
// computed financial summary used by every tab.
export function buildProjectViewModel(p: ProjectDetail, gstRatePct: number) {
  const fin = toFinProject(p);
  const base = orderBase(fin);
  const amend = amendTotal(fin);
  const disc = discountTotal(fin);
  const gst = gstOn(fin, base + amend - disc, gstRatePct);
  const cv = contractValue(fin, gstRatePct);
  const dv = dispatchedValue(fin);
  const paid = paidTotal(p.payments.map((x) => ({ amount: toNum(x.amount) })));
  const billed = billedTotal(p.bills.map((b) => ({ netPayable: toNum(b.netPayable) })));
  const balances = computeDispatchBalances(fin);
  const balanceByItem = new Map(balances.map((b) => [b.itemId, b]));

  return {
    id: p.id,
    name: p.name,
    client: p.client,
    site: p.site,
    type: p.type,
    status: p.status,
    approvalMode: p.approvalMode,
    approvalBasisNote: p.approvalBasisNote,
    poNumber: p.poNumber,
    poDate: p.poDate ? p.poDate.toISOString().slice(0, 10) : null,
    termsGst: p.termsGst,
    termsTransport: p.termsTransport,
    paymentTerms: p.paymentTerms,
    aiGenerated: p.aiGenerated,
    // Per-project costing overrides; the automatic cost rates are resolved
    // separately (services/costingService) so an item-sheet price change flows
    // through instead of being frozen here.
    costing: (p.costing ?? null) as { items?: Record<string, { rate?: number | ""; qty?: number | "" }>; extras?: { name: string; amount: number }[] } | null,
    createdAt: p.createdAt.toISOString(),

    items: p.items
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => {
        const dispatched = dispatchedQty(fin, i.id);
        const extra = extraQtyOf(fin, i.id);
        const bal = balanceByItem.get(i.id);
        return {
          id: i.id,
          orderId: i.orderId ?? null,
          description: i.description,
          make: i.make ?? "",
          splitFrom: i.splitFrom ?? null,
          unit: i.unit,
          qty: toNum(i.qty),
          rate: toNum(i.rate),
          dispatchedQty: dispatched,
          extraQty: extra,
          balanceQty: bal?.balance ?? toNum(i.qty) - dispatched,
          extraUnlocked: bal?.extraUnlocked ?? false,
        };
      }),

    orders: (p.orders || [])
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((o) => ({
        id: o.id,
        ref: o.ref,
        date: o.date ? o.date.toISOString().slice(0, 10) : null,
        attachments: o.documents.map(mapDoc),
      })),

    transports: (p.transports || [])
      .slice()
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .map((t) => ({
        id: t.id,
        date: t.date.toISOString().slice(0, 10),
        amount: toNum(t.amount),
        transporter: t.transporter,
        ref: t.ref,
        vehicle: t.vehicle,
        challanId: t.challanId,
        attachments: t.documents.map(mapDoc),
      })),

    payments: p.payments
      .slice()
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .map((x) => ({
        id: x.id,
        date: x.date.toISOString().slice(0, 10),
        amount: toNum(x.amount),
        mode: x.mode,
        reference: x.reference,
        attachments: x.documents.map(mapDoc),
      })),

    challans: p.challans
      .slice()
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .map((c) => ({
        id: c.id,
        no: c.no,
        date: c.date.toISOString().slice(0, 10),
        source: c.source,
        vehicle: c.vehicle,
        driver: c.driver,
        remarks: c.remarks,
        manualValue: c.manualValue ? toNum(c.manualValue) : null,
        items: c.items.map((ci) => ({ itemId: ci.itemId, qty: toNum(ci.qty), extraQty: toNum(ci.extraQty) })),
        extraItems: c.extraItems.map((x) => ({ description: x.description, unit: x.unit, qty: toNum(x.qty), rate: toNum(x.rate) })),
        value: challanValue(fin, {
          id: c.id,
          date: c.date.toISOString().slice(0, 10),
          manualValue: c.manualValue ? toNum(c.manualValue) : null,
          items: c.items.map((ci) => ({ itemId: ci.itemId, qty: toNum(ci.qty), extraQty: toNum(ci.extraQty) })),
          extraItems: c.extraItems.map((x) => ({ description: x.description, unit: x.unit, qty: toNum(x.qty), rate: toNum(x.rate) })),
        }),
        attachments: c.documents.map(mapDoc),
      })),

    bills: p.bills
      .slice()
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .map((b) => ({
        id: b.id,
        no: b.no,
        date: b.date.toISOString().slice(0, 10),
        grossBasic: toNum(b.grossBasic),
        discountApplied: toNum(b.discountApplied),
        discountCum: toNum(b.discountCum),
        gst: toNum(b.gst),
        transportCum: toNum(b.transportCum),
        grossToDate: toNum(b.grossToDate),
        priorBilled: toNum(b.priorBilled),
        netPayable: toNum(b.netPayable),
        extraTotal: b.lines.filter((l) => l.isExtra).reduce((s, l) => s + toNum(l.amount), 0),
        lines: b.lines.map((l) => ({
          description: l.description,
          unit: l.unit,
          orderQty: l.orderQty !== null ? toNum(l.orderQty) : null,
          cumQty: l.cumQty !== null ? toNum(l.cumQty) : null,
          rate: l.rate !== null ? toNum(l.rate) : null,
          amount: toNum(l.amount),
          isExtra: l.isExtra,
        })),
      })),

    discounts: p.discounts
      .slice()
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .map((d) => ({ id: d.id, date: d.date.toISOString().slice(0, 10), amount: toNum(d.amount), reason: d.reason })),

    amendments: p.amendments
      .slice()
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .map((a) => ({
        id: a.id,
        date: a.date.toISOString().slice(0, 10),
        description: a.description,
        valueChange: toNum(a.valueChange),
        applied: a.applied ?? false,
        attachments: a.documents.map(mapDoc),
      })),

    // Project-level documents only (order copy / approval proof). Challan
    // and amendment attachments live on their own entities above, matching
    // the prototype's per-entity attachment model (tabDocs()) rather than a
    // flat categorized document library.
    documents: p.documents.filter((d) => d.kind === "ORDER_COPY" || d.kind === "APPROVAL_PROOF").map(mapDoc),
    documentCount: p.documents.length,

    dispatchBalances: balances,

    siteAccount: siteAccountFigures(
      fin,
      p.bills.map((b) => ({ netPayable: toNum(b.netPayable) })),
      p.payments.map((x) => ({ amount: toNum(x.amount) })),
      gstRatePct
    ),

    financials: {
      orderBase: base,
      amendTotal: amend,
      discountTotal: disc,
      gst,
      contractValue: cv,
      dispatchedValue: dv,
      transportTotal: transportTotal(fin),
      billedTotal: billed,
      paidTotal: paid,
      pending: dv - paid,
      progressPct: cv > 0 ? Math.min(100, (dv / cv) * 100) : 0,
    },
  };
}

export type ProjectViewModel = ReturnType<typeof buildProjectViewModel>;
