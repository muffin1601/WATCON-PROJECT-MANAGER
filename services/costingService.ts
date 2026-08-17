import { prisma } from "../lib/prisma";
import { toNum } from "../lib/decimal";
import { normName } from "../lib/normalize";
import { costRateFromSheet, type CostRate } from "./catalogService";
import { dfmt, inr } from "../lib/format";

// Cost rates behind both costing sheets.
//
// Ported from the prototype's itemCostRate(c): the item sheet's own purchase
// price wins, and when that is not set we fall back to the most recent real
// purchase recorded against any brand of that item. The `basis` string is shown
// in the UI so the user always knows where a number came from.

export type CostRateMap = Map<string, CostRate>;

/**
 * Resolves a cost rate for every item name given, in two queries rather than
 * one per line.
 */
export async function resolveCostRates(names: string[]): Promise<CostRateMap> {
  const keys = [...new Set(names.map(normName).filter(Boolean))];
  if (!keys.length) return new Map();

  const [catalogItems, masters] = await Promise.all([
    prisma.catalogItem.findMany({
      where: { normName: { in: keys } },
      select: { normName: true, purchasePrice: true, purchaseDiscPct: true },
    }),
    // Purchases only: adjustments carry no rate, so they say nothing about cost.
    prisma.itemMaster.findMany({
      where: { entries: { some: { type: "PURCHASE" } } },
      select: {
        name: true,
        make: true,
        entries: {
          where: { type: "PURCHASE", rate: { not: null } },
          orderBy: { date: "desc" },
          take: 1,
          select: { date: true, rate: true, vendor: true },
        },
      },
    }),
  ]);

  const out: CostRateMap = new Map();

  // Preferred source: the item sheet's purchase price less our discount.
  for (const c of catalogItems) {
    const rate = costRateFromSheet(c);
    if (rate) out.set(c.normName, rate);
  }

  // Fallback: latest actual purchase across any brand of the same item.
  const latestByName = new Map<string, { date: Date; rate: number; vendor: string | null; make: string }>();
  for (const m of masters) {
    const entry = m.entries[0];
    if (!entry || entry.rate === null) continue;
    const key = normName(m.name);
    const prev = latestByName.get(key);
    if (!prev || entry.date > prev.date) {
      latestByName.set(key, { date: entry.date, rate: toNum(entry.rate), vendor: entry.vendor, make: m.make });
    }
  }
  for (const [key, best] of latestByName) {
    if (out.has(key)) continue; // sheet price already won
    if (!keys.includes(key)) continue;
    out.set(key, {
      rate: best.rate,
      basis:
        `Last purchase ${dfmt(best.date)}` +
        (best.make ? ` (${best.make})` : "") +
        (best.vendor ? ` from ${best.vendor}` : ""),
    });
  }

  return out;
}

export function costRateFor(map: CostRateMap, description: string): CostRate | null {
  return map.get(normName(description)) ?? null;
}

// ---------- Stored override shape (Project.costing / Quotation.costing) ----------

export interface CostingOverrides {
  items: Record<string, { rate?: number | ""; qty?: number | "" }>;
  extras: { name: string; amount: number }[];
  /** Quotation only: installation cost as a % of material cost. */
  installPct?: number | "";
}

export function parseCosting(raw: unknown): CostingOverrides {
  const src = (raw ?? {}) as Partial<CostingOverrides>;
  return {
    items: src.items && typeof src.items === "object" ? src.items : {},
    extras: Array.isArray(src.extras) ? src.extras : [],
    installPct: src.installPct,
  };
}

const hasOverride = (v: unknown): v is number => v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v));

// ---------- Project costing (ported from costingLines / costingTotals) ----------

export interface ProjectCostingLine {
  itemId: string;
  description: string;
  make: string;
  unit: string;
  qty: number;
  saleRate: number;
  costRate: number;
  basis: string | null;
  overridden: boolean;
  hasAutoCost: boolean;
  cost: number;
  sale: number;
}

export interface ProjectCostingResult {
  lines: ProjectCostingLine[];
  matCost: number;
  otherCost: number;
  transportCost: number;
  totalCost: number;
  sale: number;
  discounts: number;
  revenue: number;
  margin: number;
  marginPct: number;
  extras: { name: string; amount: number }[];
}

export function computeProjectCosting(input: {
  items: { id: string; description: string; make: string; unit: string; qty: number; rate: number }[];
  costing: CostingOverrides;
  costRates: CostRateMap;
  /** Sum of transport bills; only OUR cost when transport is included in rates. */
  transportTotal: number;
  transportIsIncluded: boolean;
  discountTotal: number;
}): ProjectCostingResult {
  const { items, costing, costRates, transportTotal, transportIsIncluded, discountTotal } = input;

  const lines: ProjectCostingLine[] = items.map((it) => {
    const ov = costing.items[it.id] ?? {};
    const auto = costRateFor(costRates, it.description);
    const overridden = hasOverride(ov.rate);
    const costRate = overridden ? Number(ov.rate) : auto?.rate ?? 0;
    const qty = hasOverride(ov.qty) ? Number(ov.qty) : it.qty;
    return {
      itemId: it.id,
      description: it.description,
      make: it.make,
      unit: it.unit,
      qty,
      saleRate: it.rate,
      costRate,
      basis: overridden ? "Manual" : auto?.basis ?? null,
      overridden,
      hasAutoCost: !!auto,
      cost: qty * costRate,
      sale: it.qty * it.rate,
    };
  });

  const matCost = lines.reduce((t, l) => t + l.cost, 0);
  const sale = items.reduce((t, i) => t + i.qty * i.rate, 0);
  const extras = costing.extras.filter((x) => x && (x.name || x.amount));
  const otherCost = extras.reduce((t, x) => t + (Number(x.amount) || 0), 0);
  // When transport is billed extra the client pays it, so it is not our cost.
  const transportCost = transportIsIncluded ? transportTotal : 0;
  const totalCost = matCost + otherCost + transportCost;
  const revenue = sale - discountTotal;
  const margin = revenue - totalCost;

  return {
    lines,
    matCost,
    otherCost,
    transportCost,
    totalCost,
    sale,
    discounts: discountTotal,
    revenue,
    margin,
    marginPct: revenue > 0 ? (margin / revenue) * 100 : 0,
    extras,
  };
}

// ---------- Quotation costing (ported from quoteCostLines / quoteCostTotals) ----------

export interface QuoteCostingLine {
  itemId: string;
  description: string;
  section: string;
  makes: string[];
  unit: string;
  qty: number;
  netSaleRate: number;
  costRate: number | null;
  basis: string | null;
  overridden: boolean;
  missing: boolean;
  cost: number;
  saleNet: number;
}

export interface QuoteCostingResult {
  lines: QuoteCostingLine[];
  matCost: number;
  /** Lines with no cost at all — the margin is overstated until they are costed. */
  missing: number;
  installPct: number | null;
  instCost: number;
  otherCost: number;
  totalCost: number;
  revenue: number;
  margin: number;
  marginPct: number;
  extras: { name: string; amount: number }[];
}

export function computeQuoteCosting(input: {
  items: { id: string; description: string; section: string; makes: string[]; unit: string; qty: number }[];
  /** Per-line net (post-discount) rate and amount, from services/quotationTotals. */
  netRateById: Map<string, number>;
  costing: CostingOverrides;
  costRates: CostRateMap;
  /** Quote value after discount and installation, after rounding, before GST. */
  revenue: number;
}): QuoteCostingResult {
  const { items, netRateById, costing, costRates, revenue } = input;

  const lines: QuoteCostingLine[] = items.map((it) => {
    const ov = costing.items[it.id] ?? {};
    const auto = costRateFor(costRates, it.description);
    const overridden = hasOverride(ov.rate);
    // null (not 0) when nothing is known, so "no cost" is distinguishable from
    // "genuinely free" and can be flagged red in the UI.
    const costRate = overridden ? Number(ov.rate) : auto ? auto.rate : null;
    const netRate = netRateById.get(it.id) ?? 0;
    return {
      itemId: it.id,
      description: it.description,
      section: it.section,
      makes: it.makes,
      unit: it.unit,
      qty: it.qty,
      netSaleRate: netRate,
      costRate,
      basis: overridden ? "Manual" : auto?.basis ?? null,
      overridden,
      missing: costRate === null,
      cost: costRate === null ? 0 : it.qty * costRate,
      saleNet: it.qty * netRate,
    };
  });

  const matCost = lines.reduce((t, l) => t + l.cost, 0);
  const missing = lines.filter((l) => l.missing).length;
  const installPct = hasOverride(costing.installPct) ? Number(costing.installPct) : null;
  const instCost = installPct === null ? 0 : (matCost * installPct) / 100;
  const extras = costing.extras.filter((x) => x && (x.name || x.amount));
  const otherCost = extras.reduce((t, x) => t + (Number(x.amount) || 0), 0);
  const totalCost = matCost + instCost + otherCost;
  const margin = revenue - totalCost;

  return {
    lines,
    matCost,
    missing,
    installPct,
    instCost,
    otherCost,
    totalCost,
    revenue,
    margin,
    marginPct: revenue > 0 ? (margin / revenue) * 100 : 0,
    extras,
  };
}

/** Human-readable cost basis, e.g. for the printed costing sheet. */
export function describeBasis(line: { overridden: boolean; basis: string | null }): string {
  if (line.overridden) return "Manual";
  return line.basis ?? "—";
}

// Re-exported so callers formatting a costing sheet don't need a second import.
export { inr };
