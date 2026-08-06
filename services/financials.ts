// Financial math ported EXACTLY from reference/watcon-project-management.html
// (functions orderBase, amendTotal, discountTotal, gstOn, contractValue,
// dispatchedQty, extraQtyOf, customDispatched, dispatchedValue, challanValue).
// Do not simplify or re-derive — this is the single source of truth for every
// money figure shown in the app, and must match the prototype's output.

export interface FinItem {
  id: string;
  description: string;
  unit: string;
  qty: number;
  rate: number;
}

export interface FinChallanItem {
  itemId: string;
  qty: number;
  extraQty: number;
}

export interface FinChallanExtraItem {
  description: string;
  unit: string;
  qty: number;
  rate: number;
}

export interface FinChallan {
  id: string;
  date: string; // ISO date
  items: FinChallanItem[];
  extraItems: FinChallanExtraItem[];
  manualValue?: number | null;
}

export interface FinDiscount {
  amount: number;
}

export interface FinAmendment {
  valueChange: number;
  // true = change already reflected in Sales Order item qty/rates (created
  // by "Amend sales order") — skipped in amendTotal() to avoid double count.
  applied?: boolean;
}

export interface FinTransport {
  date: string; // ISO date
  amount: number;
}

export interface FinTerms {
  gst: "included" | "extra";
  transport?: "included" | "extra";
}

export interface FinProject {
  items: FinItem[];
  challans: FinChallan[];
  discounts: FinDiscount[];
  amendments: FinAmendment[];
  transports?: FinTransport[];
  terms: FinTerms;
}

export function orderBase(p: Pick<FinProject, "items">): number {
  return p.items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0);
}

// `applied` amendments are already reflected in item qty/rates — counting
// them again would double the change (prototype: `a.applied ? 0 : value`).
export function amendTotal(p: Pick<FinProject, "amendments">): number {
  return p.amendments.reduce((s, a) => s + (a.applied ? 0 : Number(a.valueChange) || 0), 0);
}

// Ported from transportTotal(p, uptoDate) — sum of transport bills, optionally
// only those dated on or before `uptoDate`.
export function transportTotal(p: Pick<FinProject, "transports">, uptoDate?: string): number {
  return (p.transports || []).reduce((t, x) => {
    if (uptoDate && x.date > uptoDate) return t;
    return t + (Number(x.amount) || 0);
  }, 0);
}

export function discountTotal(p: Pick<FinProject, "discounts">): number {
  return p.discounts.reduce((s, d) => s + (Number(d.amount) || 0), 0);
}

export function gstOn(p: Pick<FinProject, "terms">, amt: number, gstRatePct: number): number {
  return p.terms.gst === "extra" ? amt * ((Number(gstRatePct) || 18) / 100) : 0;
}

export function contractValue(p: FinProject, gstRatePct: number): number {
  const base = orderBase(p) + amendTotal(p) - discountTotal(p);
  return base + gstOn(p, base, gstRatePct);
}

export function dispatchedQty(p: Pick<FinProject, "challans">, itemId: string, uptoDate?: string): number {
  let q = 0;
  p.challans.forEach((c) => {
    if (uptoDate && c.date > uptoDate) return;
    c.items.forEach((ci) => {
      if (ci.itemId === itemId) q += Number(ci.qty) || 0;
    });
  });
  return q;
}

export function extraQtyOf(p: Pick<FinProject, "challans">, itemId: string, uptoDate?: string): number {
  let q = 0;
  p.challans.forEach((c) => {
    if (uptoDate && c.date > uptoDate) return;
    c.items.forEach((ci) => {
      if (ci.itemId === itemId) q += Number(ci.extraQty) || 0;
    });
  });
  return q;
}

// Balance-qty math for the challan issuing form: "issued on OTHER challans"
// excludes the challan currently being edited (undefined excludeChallanId
// when creating). Ported from challanModal()'s `issuedOthers` calc.
export function dispatchedQtyExcluding(
  p: Pick<FinProject, "challans">,
  itemId: string,
  excludeChallanId?: string
): number {
  const filtered = excludeChallanId ? { challans: p.challans.filter((c) => c.id !== excludeChallanId) } : p;
  return dispatchedQty(filtered, itemId);
}

export interface DispatchBalance {
  itemId: string;
  soQty: number;
  issuedOthers: number;
  balance: number;
  extraUnlocked: boolean;
}

// Ported from the per-item row logic in challanModal(): balance = SO qty
// minus what's already dispatched on OTHER challans; extra (beyond-BOQ) qty
// only unlocks once the full SO qty has been dispatched for that item.
export function computeDispatchBalances(
  p: Pick<FinProject, "items" | "challans">,
  excludeChallanId?: string
): DispatchBalance[] {
  return p.items.map((it) => {
    const issuedOthers = dispatchedQtyExcluding(p, it.id, excludeChallanId);
    return {
      itemId: it.id,
      soQty: it.qty,
      issuedOthers,
      balance: it.qty - issuedOthers,
      extraUnlocked: issuedOthers >= it.qty,
    };
  });
}

export interface AggregatedExtra {
  description: string;
  unit: string;
  qty: number;
  rate: number;
}

export function customDispatched(p: Pick<FinProject, "challans">, uptoDate?: string): AggregatedExtra[] {
  const map: Record<string, AggregatedExtra> = {};
  p.challans.forEach((c) => {
    if (uptoDate && c.date > uptoDate) return;
    c.extraItems.forEach((x) => {
      const key = (x.description || "").trim().toLowerCase() + "|" + (x.unit || "");
      if (!map[key]) {
        map[key] = { description: x.description, unit: x.unit || "Nos", qty: 0, rate: Number(x.rate) || 0 };
      }
      map[key]!.qty += Number(x.qty) || 0;
      if (Number(x.rate)) map[key]!.rate = Number(x.rate);
    });
  });
  return Object.values(map);
}

export function dispatchedValue(p: FinProject, uptoDate?: string): number {
  let v = 0;
  p.items.forEach((it) => {
    v += (dispatchedQty(p, it.id, uptoDate) + extraQtyOf(p, it.id, uptoDate)) * (Number(it.rate) || 0);
  });
  customDispatched(p, uptoDate).forEach((x) => {
    v += x.qty * (x.rate || 0);
  });
  p.challans.forEach((c) => {
    if (uptoDate && c.date > uptoDate) return;
    if (c.manualValue) v += Number(c.manualValue) || 0;
  });
  return v;
}

export function challanValue(p: Pick<FinProject, "items">, c: FinChallan): number {
  if (c.manualValue) return Number(c.manualValue) || 0;
  let v = 0;
  c.items.forEach((ci) => {
    const it = p.items.find((x) => x.id === ci.itemId);
    if (it) v += ((Number(ci.qty) || 0) + (Number(ci.extraQty) || 0)) * (Number(it.rate) || 0);
  });
  c.extraItems.forEach((x) => {
    v += (Number(x.qty) || 0) * (Number(x.rate) || 0);
  });
  return v;
}

export function paidTotal(payments: { amount: number }[]): number {
  return payments.reduce((s, x) => s + (Number(x.amount) || 0), 0);
}

export function billedTotal(bills: { netPayable: number }[]): number {
  return bills.reduce((s, b) => s + (Number(b.netPayable) || 0), 0);
}

// Site account statement figures — ported from siteAccountFigures(p)
export function siteAccountFigures(p: FinProject, bills: { netPayable: number }[], payments: { amount: number }[], gstRatePct: number) {
  const basicDispatched = dispatchedValue(p);
  const disc = discountTotal(p);
  const taxable = Math.max(basicDispatched - disc, 0);
  const gst = p.terms.gst === "extra" ? taxable * ((Number(gstRatePct) || 18) / 100) : 0;
  // Transport at actuals is recoverable from the client only when the
  // project's transport terms are "extra" (prototype's siteAccountFigures).
  const transport = p.terms.transport === "extra" ? transportTotal(p) : 0;
  const payableToDate = taxable + gst + transport;
  const billed = billedTotal(bills);
  const unbilled = Math.max(payableToDate - billed, 0);
  const received = paidTotal(payments);
  const balance = payableToDate - received;
  return { basicDispatched, disc, gst, transport, payableToDate, billed, unbilled, received, balance };
}
