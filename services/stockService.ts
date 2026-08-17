import { prisma } from "../lib/prisma";
import { toNum } from "../lib/decimal";
import type { ItemMasterInput, StockEntryInput } from "../modules/projects/schema";

// Items & Stocks module — ported from the prototype's renderStocks() /
// syncItemsMaster() / masterStats(). One master row per item+make+unit;
// required/delivered/pending are computed across ALL projects at read time,
// only inward stock entries are stored.

export class StockValidationError extends Error {}

// Prototype's normKey(n, m, u)
export function normKey(name: string, make: string, unit: string): string {
  return [name, make, unit].map((x) => String(x || "").trim().toLowerCase().replace(/\s+/g, " ")).join("|");
}

// Auto-create master rows for every Sales Order item that doesn't have one
// yet (prototype's syncItemsMaster, run on every stocks-page load).
export async function syncItemsMaster() {
  const [items, masters] = await Promise.all([
    prisma.poItem.findMany({ select: { description: true, make: true, unit: true } }),
    prisma.itemMaster.findMany({ select: { normKey: true } }),
  ]);
  const existing = new Set(masters.map((m) => m.normKey));
  const toCreate = new Map<string, { name: string; make: string; unit: string; normKey: string }>();
  items.forEach((it) => {
    const name = String(it.description || "").trim();
    if (!name) return;
    const key = normKey(name, it.make, it.unit);
    if (existing.has(key) || toCreate.has(key)) return;
    toCreate.set(key, { name, make: String(it.make || "").trim(), unit: it.unit || "Nos", normKey: key });
  });
  if (toCreate.size) {
    await prisma.itemMaster.createMany({ data: [...toCreate.values()], skipDuplicates: true });
  }
}

export interface ItemProjectRow {
  projectId: string;
  project: string;
  client: string;
  site: string;
  required: number;
  delivered: number;
  pending: number;
}

export interface ItemMasterStats {
  rows: ItemProjectRow[];
  req: number;
  del: number;
  pending: number;
  stockIn: number;
  current: number;
}

export interface ItemMasterWithStats {
  id: string;
  name: string;
  make: string;
  unit: string;
  entries: {
    id: string;
    date: string;
    qty: number;
    note: string | null;
    type: string;
    rate: number | null;
    vendor: string | null;
    ref: string | null;
  }[];
  stats: ItemMasterStats;
  /** Most recent purchase with a rate — the prototype's lastPurchase(m). */
  lastPurchase: { date: string; rate: number; vendor: string | null } | null;
}

// Loads every master row plus its cross-project stats in three queries
// (prototype's masterStats(m) per item, computed over the same data).
export async function listItemsWithStats(): Promise<ItemMasterWithStats[]> {
  await syncItemsMaster();
  const [masters, projects] = await Promise.all([
    prisma.itemMaster.findMany({
      include: { entries: { orderBy: { date: "desc" } } },
      orderBy: [{ name: "asc" }, { make: "asc" }],
    }),
    prisma.project.findMany({
      select: {
        id: true,
        name: true,
        client: true,
        site: true,
        items: { select: { id: true, description: true, make: true, unit: true, qty: true } },
        challans: { select: { items: { select: { itemId: true, qty: true, extraQty: true } } } },
      },
    }),
  ]);

  // Dispatched qty per Sales Order item id (qty + extraQty), across challans.
  return masters.map((m) => {
    const key = m.normKey;
    const rows: ItemProjectRow[] = [];
    let req = 0;
    let del = 0;
    projects.forEach((p) => {
      const dispatchByItem = new Map<string, number>();
      p.challans.forEach((c) =>
        c.items.forEach((ci) => {
          dispatchByItem.set(ci.itemId, (dispatchByItem.get(ci.itemId) || 0) + toNum(ci.qty) + toNum(ci.extraQty));
        })
      );
      let r = 0;
      let d = 0;
      p.items.forEach((it) => {
        if (normKey(it.description, it.make, it.unit) !== key) return;
        r += toNum(it.qty);
        d += dispatchByItem.get(it.id) || 0;
      });
      if (r > 0 || d > 0) {
        rows.push({
          projectId: p.id,
          project: p.name,
          client: p.client,
          site: p.site || "",
          required: r,
          delivered: d,
          pending: Math.max(r - d, 0),
        });
        req += r;
        del += d;
      }
    });
    const stockIn = m.entries.reduce((t, e) => t + toNum(e.qty), 0);
    // entries arrive newest-first, so the first purchase with a rate is the
    // latest one (prototype's lastPurchase(m)).
    const lp = m.entries.find((e) => e.type === "PURCHASE" && e.rate !== null && toNum(e.rate) > 0);
    return {
      id: m.id,
      name: m.name,
      make: m.make,
      unit: m.unit,
      entries: m.entries.map((e) => ({
        id: e.id,
        date: e.date.toISOString().slice(0, 10),
        qty: toNum(e.qty),
        note: e.note,
        type: e.type,
        rate: e.rate === null ? null : toNum(e.rate),
        vendor: e.vendor,
        ref: e.ref,
      })),
      stats: { rows, req, del, pending: Math.max(req - del, 0), stockIn, current: stockIn - del },
      lastPurchase: lp
        ? { date: lp.date.toISOString().slice(0, 10), rate: toNum(lp.rate), vendor: lp.vendor }
        : null,
    };
  });
}

export async function createItemMaster(input: ItemMasterInput) {
  const name = input.name.trim();
  const make = (input.make || "").trim();
  const unit = (input.unit || "Nos").trim() || "Nos";
  const key = normKey(name, make, unit);
  const dup = await prisma.itemMaster.findUnique({ where: { normKey: key } });
  if (dup) throw new StockValidationError("This item + make already exists");
  return prisma.itemMaster.create({ data: { name, make, unit, normKey: key } });
}

// Prototype note: a deleted master "reappears automatically if it is still on
// any sales order" — syncItemsMaster() recreates it on the next page load.
export async function deleteItemMaster(id: string) {
  return prisma.itemMaster.delete({ where: { id } });
}

export async function addStockEntry(itemMasterId: string, input: StockEntryInput) {
  return prisma.stockEntry.create({
    data: {
      itemMasterId,
      date: new Date(input.date),
      qty: input.qty,
      type: input.type,
      rate: input.rate,
      vendor: input.vendor || null,
      ref: input.ref || null,
      note: input.note || null,
    },
  });
}

export async function deleteStockEntry(entryId: string) {
  return prisma.stockEntry.delete({ where: { id: entryId } });
}
