import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { toNum } from "../lib/decimal";
import { normName } from "../lib/normalize";
import { normKey } from "./stockService";
import { DOCUMENTS_BUCKET } from "../lib/supabaseServer";
import type { CatalogItemInput, CatalogItemUpdateInput, CatalogListQuery } from "../modules/catalog/schema";

// Item Sheet — the master product list. Everything quotations and costing
// price off lives here.

export class CatalogValidationError extends Error {}
export class CatalogConflictError extends Error {}

// Net client-facing rate: list price less the item's standard discount.
export function netSellRate(item: { sellPrice: unknown; discountPct: unknown }): number | null {
  if (item.sellPrice === null || item.sellPrice === undefined) return null;
  const price = toNum(item.sellPrice as never);
  const disc = toNum(item.discountPct as never);
  return Math.round(price * (1 - disc / 100) * 100) / 100;
}

// What the item costs us, and where that figure came from. Falls back to the
// most recent real purchase when no purchase list price has been entered, so
// costing sheets still have a basis instead of silently reading zero.
export interface CostRate {
  rate: number;
  basis: string;
}

export function costRateFromSheet(item: { purchasePrice: unknown; purchaseDiscPct: unknown }): CostRate | null {
  if (item.purchasePrice === null || item.purchasePrice === undefined) return null;
  const price = toNum(item.purchasePrice as never);
  if (!(price > 0)) return null;
  const disc = toNum(item.purchaseDiscPct as never);
  return {
    rate: Math.round(price * (1 - disc / 100) * 100) / 100,
    basis: `Purchase list ₹${price.toLocaleString("en-IN")}${disc ? ` less ${disc}%` : ""}`,
  };
}

export interface CatalogItemDto {
  id: string;
  name: string;
  unit: string;
  category: string | null;
  hsn: string | null;
  details: string | null;
  makes: string[];
  sellPrice: number | null;
  discountPct: number | null;
  netRate: number | null;
  purchasePrice: number | null;
  purchaseDiscPct: number | null;
  costRate: number | null;
  costBasis: string | null;
  components: { id: string; name: string; make: string; unit: string; qty: number }[];
  archivedAt: string | null;
  /** Public URL of the product photo, or null when none has been uploaded. */
  imageUrl: string | null;
}

// The documents bucket is public-read, so a product photo can be rendered with
// a plain <img src>. Built here rather than in the browser so the bucket name
// stays server-side knowledge.
function publicImageUrl(path: string | null): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/${DOCUMENTS_BUCKET}/${path}`;
}

type CatalogRow = Prisma.CatalogItemGetPayload<{ include: { components: true } }>;

function toDto(c: CatalogRow): CatalogItemDto {
  const cost = costRateFromSheet(c);
  return {
    id: c.id,
    name: c.name,
    unit: c.unit,
    category: c.category,
    hsn: c.hsn,
    details: c.details,
    makes: c.makes,
    sellPrice: c.sellPrice === null ? null : toNum(c.sellPrice),
    discountPct: c.discountPct === null ? null : toNum(c.discountPct),
    netRate: netSellRate(c),
    purchasePrice: c.purchasePrice === null ? null : toNum(c.purchasePrice),
    purchaseDiscPct: c.purchaseDiscPct === null ? null : toNum(c.purchaseDiscPct),
    costRate: cost?.rate ?? null,
    costBasis: cost?.basis ?? null,
    components: c.components
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((x) => ({ id: x.id, name: x.name, make: x.make, unit: x.unit, qty: toNum(x.qty) })),
    archivedAt: c.archivedAt ? c.archivedAt.toISOString() : null,
    imageUrl: publicImageUrl(c.imagePath),
  };
}

export interface CatalogListResult {
  rows: CatalogItemDto[];
  categories: string[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export async function listCatalogItems(query: CatalogListQuery): Promise<CatalogListResult> {
  const where: Prisma.CatalogItemWhereInput = {
    ...(query.includeArchived ? {} : { archivedAt: null }),
    ...(query.category ? { category: query.category } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: "insensitive" } },
            { category: { contains: query.q, mode: "insensitive" } },
            { details: { contains: query.q, mode: "insensitive" } },
            { makes: { has: query.q } },
          ],
        }
      : {}),
  };

  const [total, rows, categoryRows] = await Promise.all([
    prisma.catalogItem.count({ where }),
    prisma.catalogItem.findMany({
      where,
      include: { components: true },
      orderBy: { name: "asc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.catalogItem.findMany({
      where: { archivedAt: null, category: { not: null } },
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    }),
  ]);

  return {
    rows: rows.map(toDto),
    categories: categoryRows.map((c) => c.category).filter((c): c is string => !!c),
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function getCatalogItem(id: string): Promise<CatalogItemDto | null> {
  const row = await prisma.catalogItem.findUnique({ where: { id }, include: { components: true } });
  return row ? toDto(row) : null;
}

export async function getCatalogItemByName(name: string): Promise<CatalogItemDto | null> {
  const key = normName(name);
  if (!key) return null;
  const row = await prisma.catalogItem.findUnique({ where: { normName: key }, include: { components: true } });
  return row ? toDto(row) : null;
}

function scalarData(input: CatalogItemInput | CatalogItemUpdateInput) {
  const blankToNull = (v: string | undefined) => (v === undefined ? undefined : v.trim() === "" ? null : v.trim());
  return {
    ...(input.name !== undefined ? { name: input.name.trim(), normName: normName(input.name) } : {}),
    ...(input.unit !== undefined ? { unit: input.unit.trim() || "Nos" } : {}),
    category: blankToNull(input.category),
    hsn: blankToNull(input.hsn),
    details: blankToNull(input.details),
    ...(input.makes !== undefined ? { makes: [...new Set(input.makes.map((m) => m.trim()).filter(Boolean))] } : {}),
    ...(input.sellPrice !== undefined ? { sellPrice: input.sellPrice } : {}),
    ...(input.discountPct !== undefined ? { discountPct: input.discountPct } : {}),
    ...(input.purchasePrice !== undefined ? { purchasePrice: input.purchasePrice } : {}),
    ...(input.purchaseDiscPct !== undefined ? { purchaseDiscPct: input.purchaseDiscPct } : {}),
  };
}

export async function createCatalogItem(input: CatalogItemInput): Promise<CatalogItemDto> {
  const key = normName(input.name);
  if (!key) throw new CatalogValidationError("Item name is required");
  const existing = await prisma.catalogItem.findUnique({ where: { normName: key } });
  if (existing) {
    throw new CatalogConflictError(
      existing.archivedAt
        ? `"${existing.name}" already exists on the sheet but is archived — restore it instead of creating a duplicate.`
        : `An item named "${existing.name}" already exists on the sheet.`
    );
  }
  const created = await prisma.catalogItem.create({
    data: {
      ...scalarData(input),
      name: input.name.trim(),
      normName: key,
      unit: input.unit.trim() || "Nos",
      components: {
        create: (input.components ?? []).map((c, i) => ({
          name: c.name,
          make: c.make,
          unit: c.unit,
          qty: c.qty,
          sortOrder: i,
        })),
      },
    },
    include: { components: true },
  });
  return toDto(created);
}

export async function updateCatalogItem(id: string, input: CatalogItemUpdateInput): Promise<CatalogItemDto> {
  if (input.name !== undefined) {
    const key = normName(input.name);
    if (!key) throw new CatalogValidationError("Item name is required");
    const clash = await prisma.catalogItem.findUnique({ where: { normName: key } });
    if (clash && clash.id !== id) throw new CatalogConflictError(`An item named "${clash.name}" already exists on the sheet.`);
  }

  // Components are replaced wholesale inside one transaction: a partial
  // rewrite (delete some, add some) could leave the bill of materials
  // half-updated if the request failed midway.
  const updated = await prisma.$transaction(async (tx) => {
    if (input.components !== undefined) {
      await tx.catalogComponent.deleteMany({ where: { catalogItemId: id } });
      if (input.components.length) {
        await tx.catalogComponent.createMany({
          data: input.components.map((c, i) => ({
            catalogItemId: id,
            name: c.name,
            make: c.make,
            unit: c.unit,
            qty: c.qty,
            sortOrder: i,
          })),
        });
      }
    }
    return tx.catalogItem.update({ where: { id }, data: scalarData(input), include: { components: true } });
  });
  return toDto(updated);
}

export async function archiveCatalogItem(id: string) {
  return prisma.catalogItem.update({ where: { id }, data: { archivedAt: new Date() } });
}

export async function restoreCatalogItem(id: string) {
  return prisma.catalogItem.update({ where: { id }, data: { archivedAt: null } });
}

// Only ever hard-deletes an item nothing refers to. Anything quoted is
// archived instead, so historical quotations keep their catalogue link.
export async function deleteCatalogItemIfUnused(id: string) {
  const used = await prisma.quotationItem.count({ where: { catalogItemId: id } });
  if (used > 0) {
    throw new CatalogValidationError(
      `This item is used on ${used} quotation line(s). Archive it instead so those quotations keep their pricing history.`
    );
  }
  return prisma.catalogItem.delete({ where: { id } });
}

// Picker payload — deliberately narrow so the item chooser stays fast.
export async function listCatalogOptions(q: string) {
  const rows = await prisma.catalogItem.findMany({
    where: {
      archivedAt: null,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { category: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      unit: true,
      category: true,
      details: true,
      makes: true,
      sellPrice: true,
      discountPct: true,
      purchasePrice: true,
      purchaseDiscPct: true,
    },
    orderBy: { name: "asc" },
    take: 50,
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    unit: r.unit,
    category: r.category,
    details: r.details,
    makes: r.makes,
    sellPrice: r.sellPrice === null ? null : toNum(r.sellPrice),
    discountPct: r.discountPct === null ? null : toNum(r.discountPct),
    netRate: netSellRate(r),
    costRate: costRateFromSheet(r)?.rate ?? null,
  }));
}

// ---------- Duplicate detection & merge (prototype's similarNames /
// duplicateGroups / renameItemEverywhere / dupesModal) ----------

const words = (s: string) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);

/** Ported from similarNames(): ≥60% word overlap counts as "looks like". */
function looksSimilar(a: string, b: string): boolean {
  const wa = words(a);
  const wb = words(b);
  if (!wa.length || !wb.length) return false;
  const overlap = wa.filter((w) => wb.some((v) => v.startsWith(w) || w.startsWith(v))).length;
  return overlap / Math.max(wa.length, wb.length) >= 0.6;
}

/** Groups of catalogue names that look like the same product written differently. */
export async function duplicateGroups(): Promise<string[][]> {
  const items = await prisma.catalogItem.findMany({
    where: { archivedAt: null },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  const names = items.map((i) => i.name);
  const used = new Set<string>();
  const groups: string[][] = [];

  names.forEach((n) => {
    if (used.has(n)) return;
    const sim = names.filter((x) => x !== n && !used.has(x) && looksSimilar(n, x));
    if (sim.length) {
      const group = [n, ...sim];
      group.forEach((x) => used.add(x));
      groups.push(group);
    }
  });
  return groups;
}

/**
 * Merges duplicate item names into one, ported from renameItemEverywhere() +
 * the merge branch of dupesModal().
 *
 * Everything happens in one transaction. Quantities, rates and values are never
 * touched — only the NAME is rewritten, on every sales order line, quotation
 * line, stock master and catalogue entry that used a losing spelling. The
 * losing catalogue rows donate their brands/details/image to the survivor
 * before being removed, and stock masters that collide after renaming are
 * folded together so their entries survive rather than hitting the unique key.
 */
export async function mergeDuplicateNames(keepName: string, mergeNames: string[]): Promise<{ renamed: number }> {
  const keep = keepName.trim();
  if (!keep) throw new CatalogValidationError("Choose the name to keep");
  const losers = mergeNames.map((n) => n.trim()).filter((n) => n && n.toLowerCase() !== keep.toLowerCase());
  if (!losers.length) throw new CatalogValidationError("Nothing to merge");

  return prisma.$transaction(async (tx) => {
    const survivor = await tx.catalogItem.findUnique({ where: { normName: normName(keep) } });
    if (!survivor) throw new CatalogValidationError(`"${keep}" is not on the item sheet.`);

    let renamed = 0;

    for (const loser of losers) {
      const loserKey = normName(loser);
      if (loserKey === survivor.normName) continue;

      // Sales order and quotation lines keep their numbers; only the text moves.
      const po = await tx.poItem.updateMany({ where: { description: loser }, data: { description: keep } });
      const qi = await tx.quotationItem.updateMany({ where: { description: loser }, data: { description: keep } });
      renamed += po.count + qi.count;

      // Fold the losing catalogue row into the survivor.
      const dup = await tx.catalogItem.findUnique({ where: { normName: loserKey } });
      if (dup && dup.id !== survivor.id) {
        const makes = [...new Set([...survivor.makes, ...dup.makes])];
        await tx.catalogItem.update({
          where: { id: survivor.id },
          data: {
            makes,
            details: survivor.details ?? dup.details,
            imagePath: survivor.imagePath ?? dup.imagePath,
            imageMime: survivor.imageMime ?? dup.imageMime,
            category: survivor.category ?? dup.category,
            hsn: survivor.hsn ?? dup.hsn,
          },
        });
        // Quotation lines pointing at the losing catalogue row follow it.
        await tx.quotationItem.updateMany({ where: { catalogItemId: dup.id }, data: { catalogItemId: survivor.id } });
        await tx.catalogItem.delete({ where: { id: dup.id } });
      }

      // Stock masters: rename, folding any row that now collides on normKey so
      // its stock entries are preserved instead of violating the unique index.
      const masters = await tx.itemMaster.findMany({ where: { name: loser } });
      for (const m of masters) {
        const newKey = normKey(keep, m.make, m.unit);
        const clash = await tx.itemMaster.findUnique({ where: { normKey: newKey } });
        if (clash && clash.id !== m.id) {
          await tx.stockEntry.updateMany({ where: { itemMasterId: m.id }, data: { itemMasterId: clash.id } });
          await tx.itemMaster.delete({ where: { id: m.id } });
        } else {
          await tx.itemMaster.update({ where: { id: m.id }, data: { name: keep, normKey: newKey } });
        }
      }
    }

    return { renamed };
  });
}

// ---------- Product image ----------

export async function setCatalogImage(id: string, image: { path: string; mime: string } | null) {
  return prisma.catalogItem.update({
    where: { id },
    data: { imagePath: image?.path ?? null, imageMime: image?.mime ?? null },
  });
}

// Seeds the sheet from item names already used across sales orders and
// quotations, so an existing deployment doesn't start with an empty catalogue.
// Purely additive: never overwrites an item that already exists.
export async function seedCatalogFromUsage(): Promise<number> {
  const [poItems, quoteItems, existing] = await Promise.all([
    prisma.poItem.findMany({ select: { description: true, make: true, unit: true } }),
    prisma.quotationItem.findMany({ select: { description: true, makes: true, unit: true } }),
    prisma.catalogItem.findMany({ select: { normName: true } }),
  ]);

  const have = new Set(existing.map((c) => c.normName));
  const toCreate = new Map<string, { name: string; normName: string; unit: string; makes: string[] }>();

  const add = (name: string, unit: string, makes: string[]) => {
    const clean = String(name || "").trim();
    if (!clean) return;
    const key = normName(clean);
    if (have.has(key)) return;
    const found = toCreate.get(key);
    if (found) {
      // Same product seen again with another brand — collect every make.
      found.makes = [...new Set([...found.makes, ...makes.filter(Boolean)])];
      return;
    }
    toCreate.set(key, { name: clean, normName: key, unit: unit || "Nos", makes: makes.filter(Boolean) });
  };

  poItems.forEach((i) => add(i.description, i.unit, [i.make]));
  quoteItems.forEach((i) => add(i.description, i.unit, i.makes));

  if (!toCreate.size) return 0;
  const result = await prisma.catalogItem.createMany({ data: [...toCreate.values()], skipDuplicates: true });
  return result.count;
}
