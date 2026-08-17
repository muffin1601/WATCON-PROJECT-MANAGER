import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { toNum } from "../lib/decimal";
import { ensureCustomer } from "./customerService";
import { lineNetRate, quoteTotals, type QuoteLine, type QuoteTerms } from "./quotationTotals";
import type { QuotationInput, QuotationListQuery, QuotationUpdateInput } from "../modules/quotations/schema";

// Quotations module: create/edit/duplicate, status transitions, and the
// one-way conversion into a real project.

export class QuotationValidationError extends Error {}
export class QuotationConflictError extends Error {}

// The database is WAN-remote (ap-southeast-2), so a round trip costs real
// milliseconds. Quotation numbering serializes concurrent creates on a single
// settings row, and each waiter's clock starts when it joins the queue — with
// Prisma's 5s default, a handful of simultaneous creates time out before they
// ever acquire the lock. These limits give the queue room to drain; the work
// inside each transaction is deliberately tiny, so a long wait means
// contention, never a slow transaction.
const TX_OPTS = { timeout: 20_000, maxWait: 20_000 } as const;

const quotationInclude = { items: { orderBy: { sortOrder: "asc" } } } as const;
type QuotationRow = Prisma.QuotationGetPayload<{ include: typeof quotationInclude }>;

export interface QuotationItemDto {
  id: string;
  catalogItemId: string | null;
  section: string;
  description: string;
  makes: string[];
  unit: string;
  qty: number;
  rate: number;
  discPct: number | null;
}

export interface QuotationDto {
  id: string;
  ref: string;
  date: string;
  customerId: string | null;
  client: string;
  billing: string;
  delivery: string;
  title: string;
  refBy: string;
  salesPerson: string;
  status: string;
  validityDays: number;
  discountPct: number;
  installMode: "INCLUDED" | "EXTRA";
  installBasis: "PERCENT" | "LUMPSUM" | "PER_UNIT";
  installValue: number;
  transportMode: "INCLUDED" | "EXTRA";
  transportAmount: number;
  gstMode: "INCLUDED" | "EXTRA";
  gstPct: number;
  roundTo: number | null;
  note: string;
  terms: string;
  showDetails: boolean;
  areaTotalsWithGst: boolean;
  sections: string[];
  items: QuotationItemDto[];
  totals: ReturnType<typeof quoteTotals>;
  /** Per-quotation costing overrides; automatic cost rates are resolved separately. */
  costing: {
    items?: Record<string, { rate?: number | "" }>;
    extras?: { name: string; amount: number }[];
    installPct?: number | "";
  } | null;
  convertedProjectId: string | null;
  convertedAt: string | null;
  archivedAt: string | null;
}

export function toQuoteTerms(q: {
  discountPct: unknown;
  installMode: string;
  installBasis: string;
  installValue: unknown;
  transportMode: string;
  transportAmount: unknown;
  gstMode: string;
  gstPct: unknown;
  roundTo: unknown;
  areaTotalsWithGst: boolean;
}): QuoteTerms {
  return {
    discountPct: toNum(q.discountPct as never),
    installMode: q.installMode as "INCLUDED" | "EXTRA",
    installBasis: q.installBasis as "PERCENT" | "LUMPSUM" | "PER_UNIT",
    installValue: toNum(q.installValue as never),
    transportMode: q.transportMode as "INCLUDED" | "EXTRA",
    transportAmount: toNum(q.transportAmount as never),
    gstMode: q.gstMode as "INCLUDED" | "EXTRA",
    gstPct: toNum(q.gstPct as never),
    roundTo: q.roundTo === null || q.roundTo === undefined ? null : toNum(q.roundTo as never),
    areaTotalsWithGst: q.areaTotalsWithGst,
  };
}

export function toQuoteLines(items: { section: string; qty: unknown; rate: unknown; discPct: unknown }[]): QuoteLine[] {
  return items.map((i) => ({
    section: i.section,
    qty: toNum(i.qty as never),
    rate: toNum(i.rate as never),
    discPct: i.discPct === null || i.discPct === undefined ? null : toNum(i.discPct as never),
  }));
}

export function toDto(q: QuotationRow): QuotationDto {
  const terms = toQuoteTerms(q);
  const lines = toQuoteLines(q.items);
  return {
    id: q.id,
    ref: q.ref,
    date: q.date.toISOString().slice(0, 10),
    customerId: q.customerId,
    client: q.client,
    billing: q.billing ?? "",
    delivery: q.delivery ?? "",
    title: q.title,
    refBy: q.refBy ?? "",
    salesPerson: q.salesPerson ?? "",
    status: q.status,
    validityDays: q.validityDays,
    discountPct: toNum(q.discountPct),
    installMode: q.installMode,
    installBasis: q.installBasis,
    installValue: toNum(q.installValue),
    transportMode: q.transportMode,
    transportAmount: toNum(q.transportAmount),
    gstMode: q.gstMode,
    gstPct: toNum(q.gstPct),
    roundTo: q.roundTo === null ? null : toNum(q.roundTo),
    note: q.note ?? "",
    terms: q.terms ?? "",
    showDetails: q.showDetails,
    areaTotalsWithGst: q.areaTotalsWithGst,
    sections: q.sections,
    items: q.items.map((i) => ({
      id: i.id,
      catalogItemId: i.catalogItemId,
      section: i.section,
      description: i.description,
      makes: i.makes,
      unit: i.unit,
      qty: toNum(i.qty),
      rate: toNum(i.rate),
      discPct: i.discPct === null ? null : toNum(i.discPct),
    })),
    totals: quoteTotals(terms, lines),
    costing: (q.costing ?? null) as QuotationDto["costing"],
    convertedProjectId: q.convertedProjectId,
    convertedAt: q.convertedAt ? q.convertedAt.toISOString() : null,
    archivedAt: q.archivedAt ? q.archivedAt.toISOString() : null,
  };
}

// Allocates the next quotation number atomically. A plain read-then-write of
// Setting.quoteNext lets two concurrent creates take the same number; an
// UPDATE ... RETURNING is a single statement, so the database serializes them
// and each caller provably gets a distinct value.
//
// IMPORTANT: this statement takes a row lock on the settings row that is held
// until the surrounding transaction commits, so every concurrent quotation
// create queues behind it. Keep the work inside that transaction to an
// absolute minimum — anything slow in there (an extra round trip on a
// WAN-remote database) multiplies across every waiter and pushes them past
// the transaction timeout. Resolve customers and any other lookups BEFORE
// opening the transaction.
async function allocateRef(tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<{ quotePrefix: string; quoteNext: number }[]>`
    UPDATE "settings"
       SET "quoteNext" = "quoteNext" + 1,
           "updatedAt" = NOW()
     WHERE "key" = 'default'
    RETURNING "quotePrefix", "quoteNext" - 1 AS "quoteNext"
  `;
  const row = rows[0];
  if (!row) throw new QuotationValidationError("Settings row is missing — open Settings once and save it.");
  return `${row.quotePrefix}${String(row.quoteNext).padStart(3, "0")}`;
}

// Recomputes every stored total from the line items. Called on every write so
// a client cannot post a tampered grand total.
function computedTotals(input: {
  discountPct: number;
  installMode: string;
  installBasis: string;
  installValue: number;
  transportMode: string;
  transportAmount: number;
  gstMode: string;
  gstPct: number;
  roundTo: number | null;
  areaTotalsWithGst: boolean;
  items: { section: string; qty: number; rate: number; discPct: number | null }[];
}) {
  const terms: QuoteTerms = {
    discountPct: input.discountPct,
    installMode: input.installMode as "INCLUDED" | "EXTRA",
    installBasis: input.installBasis as "PERCENT" | "LUMPSUM" | "PER_UNIT",
    installValue: input.installValue,
    transportMode: input.transportMode as "INCLUDED" | "EXTRA",
    transportAmount: input.transportAmount,
    gstMode: input.gstMode as "INCLUDED" | "EXTRA",
    gstPct: input.gstPct,
    roundTo: input.roundTo,
    areaTotalsWithGst: input.areaTotalsWithGst,
  };
  const t = quoteTotals(terms, input.items);
  return {
    subtotal: t.subtotal,
    discountAmount: t.discountAmount,
    netAmount: t.netAmount,
    installAmount: t.installAmount,
    roundedAmount: t.roundedAmount,
    gstAmount: t.gstAmount,
    grandTotal: t.grandTotal,
  };
}

const blankToNull = (v: string | undefined) => (v === undefined ? undefined : v.trim() === "" ? null : v.trim());

export async function createQuotation(input: QuotationInput): Promise<QuotationDto> {
  // Resolved BEFORE the transaction opens: ensureCustomer is idempotent, so
  // doing it here is safe, and it keeps the number-allocating transaction (and
  // therefore the settings row lock) down to two statements. See allocateRef.
  let customerId = input.customerId ?? null;
  if (customerId) {
    const exists = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!exists) throw new QuotationValidationError("The selected customer no longer exists.");
  } else {
    const customer = await ensureCustomer(input.client);
    customerId = customer?.id ?? null;
  }

  const items = (input.items ?? []).map((i, idx) => ({ ...i, sortOrder: idx }));
  const totals = computedTotals({ ...input, roundTo: input.roundTo ?? null, items });

  return prisma.$transaction(async (tx) => {
    const ref = await allocateRef(tx);

    const created = await tx.quotation.create({
      data: {
        ref,
        date: new Date(input.date),
        customerId,
        client: input.client.trim(),
        billing: blankToNull(input.billing) ?? null,
        delivery: blankToNull(input.delivery) ?? null,
        title: input.title.trim(),
        refBy: blankToNull(input.refBy) ?? null,
        salesPerson: blankToNull(input.salesPerson) ?? null,
        status: input.status,
        validityDays: input.validityDays,
        discountPct: input.discountPct,
        installMode: input.installMode,
        installBasis: input.installBasis,
        installValue: input.installValue,
        transportMode: input.transportMode,
        transportAmount: input.transportAmount,
        gstMode: input.gstMode,
        gstPct: input.gstPct,
        roundTo: input.roundTo ?? null,
        note: blankToNull(input.note) ?? null,
        terms: blankToNull(input.terms) ?? null,
        showDetails: input.showDetails,
        areaTotalsWithGst: input.areaTotalsWithGst,
        sections: (input.sections ?? []).filter(Boolean),
        ...totals,
        items: {
          create: items.map((i) => ({
            catalogItemId: i.catalogItemId ?? null,
            section: i.section,
            description: i.description,
            makes: i.makes,
            unit: i.unit,
            qty: i.qty,
            rate: i.rate,
            discPct: i.discPct,
            sortOrder: i.sortOrder,
          })),
        },
      },
      include: quotationInclude,
    });
    return toDto(created);
  }, TX_OPTS);
}

export async function updateQuotation(id: string, input: QuotationUpdateInput): Promise<QuotationDto> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.quotation.findUnique({ where: { id }, include: quotationInclude });
    if (!existing) throw new QuotationValidationError("Quotation not found");
    if (existing.status === "CONVERTED") {
      throw new QuotationConflictError(
        "This quotation has already been converted into a project and can no longer be edited. Duplicate it to make a revised version."
      );
    }

    // Merge over the stored values so a PATCH of one field still recomputes
    // totals against the complete, current picture.
    const merged = {
      discountPct: input.discountPct ?? toNum(existing.discountPct),
      installMode: input.installMode ?? existing.installMode,
      installBasis: input.installBasis ?? existing.installBasis,
      installValue: input.installValue ?? toNum(existing.installValue),
      transportMode: input.transportMode ?? existing.transportMode,
      transportAmount: input.transportAmount ?? toNum(existing.transportAmount),
      gstMode: input.gstMode ?? existing.gstMode,
      gstPct: input.gstPct ?? toNum(existing.gstPct),
      roundTo: input.roundTo !== undefined ? input.roundTo : existing.roundTo === null ? null : toNum(existing.roundTo),
      areaTotalsWithGst: input.areaTotalsWithGst ?? existing.areaTotalsWithGst,
    };

    const items =
      input.items !== undefined
        ? input.items.map((i, idx) => ({ ...i, sortOrder: idx }))
        : existing.items.map((i, idx) => ({
            catalogItemId: i.catalogItemId,
            section: i.section,
            description: i.description,
            makes: i.makes,
            unit: i.unit,
            qty: toNum(i.qty),
            rate: toNum(i.rate),
            discPct: i.discPct === null ? null : toNum(i.discPct),
            sortOrder: idx,
          }));

    const totals = computedTotals({ ...merged, items });

    // Lines are replaced wholesale rather than diffed: the editor sends the
    // full ordered list, and a partial apply could leave a half-saved quote.
    if (input.items !== undefined) {
      await tx.quotationItem.deleteMany({ where: { quotationId: id } });
      if (items.length) {
        await tx.quotationItem.createMany({
          data: items.map((i) => ({
            quotationId: id,
            catalogItemId: i.catalogItemId ?? null,
            section: i.section ?? "",
            description: i.description,
            makes: i.makes ?? [],
            unit: i.unit ?? "Nos",
            qty: i.qty,
            rate: i.rate,
            discPct: i.discPct ?? null,
            sortOrder: i.sortOrder,
          })),
        });
      }
    }

    let customerId = existing.customerId;
    if (input.customerId !== undefined) customerId = input.customerId;
    else if (input.client !== undefined && !existing.customerId) {
      customerId = (await ensureCustomer(input.client, tx))?.id ?? null;
    }

    const updated = await tx.quotation.update({
      where: { id },
      data: {
        ...(input.date !== undefined ? { date: new Date(input.date) } : {}),
        customerId,
        ...(input.client !== undefined ? { client: input.client.trim() } : {}),
        billing: blankToNull(input.billing),
        delivery: blankToNull(input.delivery),
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        refBy: blankToNull(input.refBy),
        salesPerson: blankToNull(input.salesPerson),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.validityDays !== undefined ? { validityDays: input.validityDays } : {}),
        ...merged,
        note: blankToNull(input.note),
        terms: blankToNull(input.terms),
        ...(input.showDetails !== undefined ? { showDetails: input.showDetails } : {}),
        ...(input.sections !== undefined ? { sections: input.sections.filter(Boolean) } : {}),
        ...totals,
      },
      include: quotationInclude,
    });
    return toDto(updated);
  }, TX_OPTS);
}

export async function getQuotation(id: string): Promise<QuotationDto | null> {
  const q = await prisma.quotation.findUnique({ where: { id }, include: quotationInclude });
  return q ? toDto(q) : null;
}

export interface QuotationListRow {
  id: string;
  ref: string;
  date: string;
  client: string;
  customerId: string | null;
  title: string;
  refBy: string | null;
  grandTotal: number;
  status: string;
  convertedProjectId: string | null;
  archivedAt: string | null;
}

export interface QuotationListResult {
  rows: QuotationListRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  summary: { count: number; value: number; accepted: number; open: number };
}

export async function listQuotations(query: QuotationListQuery): Promise<QuotationListResult> {
  const where: Prisma.QuotationWhereInput = {
    ...(query.includeArchived ? {} : { archivedAt: null }),
    ...(query.status ? { status: query.status } : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.from || query.to
      ? {
          date: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
    ...(query.q
      ? {
          OR: [
            { ref: { contains: query.q, mode: "insensitive" } },
            { client: { contains: query.q, mode: "insensitive" } },
            { title: { contains: query.q, mode: "insensitive" } },
            { refBy: { contains: query.q, mode: "insensitive" } },
            { salesPerson: { contains: query.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.QuotationOrderByWithRelationInput =
    query.sort === "value" ? { grandTotal: "desc" } : query.sort === "ref" ? { ref: "asc" } : { date: "desc" };

  const [total, rows, agg, accepted, open] = await Promise.all([
    prisma.quotation.count({ where }),
    prisma.quotation.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        ref: true,
        date: true,
        client: true,
        customerId: true,
        title: true,
        refBy: true,
        grandTotal: true,
        status: true,
        convertedProjectId: true,
        archivedAt: true,
      },
    }),
    // Summary covers the whole filtered set, not just the visible page.
    prisma.quotation.aggregate({ where, _sum: { grandTotal: true } }),
    prisma.quotation.count({ where: { ...where, status: { in: ["ACCEPTED", "CONVERTED"] } } }),
    prisma.quotation.count({ where: { ...where, status: { in: ["DRAFT", "SENT"] } } }),
  ]);

  return {
    rows: rows.map((r) => ({
      ...r,
      date: r.date.toISOString().slice(0, 10),
      grandTotal: toNum(r.grandTotal),
      archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    summary: { count: total, value: toNum(agg._sum.grandTotal), accepted, open },
  };
}

export async function archiveQuotation(id: string) {
  return prisma.quotation.update({ where: { id }, data: { archivedAt: new Date() } });
}

export async function restoreQuotation(id: string) {
  return prisma.quotation.update({ where: { id }, data: { archivedAt: null } });
}

export async function deleteQuotation(id: string) {
  const q = await prisma.quotation.findUnique({ where: { id }, select: { status: true, convertedProjectId: true } });
  if (!q) throw new QuotationValidationError("Quotation not found");
  if (q.convertedProjectId) {
    throw new QuotationConflictError(
      "This quotation has been converted into a project. Archive it instead so the project keeps its origin document."
    );
  }
  return prisma.quotation.delete({ where: { id } });
}

// Copies a quotation into a fresh DRAFT with a new number — the normal way to
// produce a revised version without destroying the one already sent.
export async function duplicateQuotation(id: string): Promise<QuotationDto> {
  // Read the source outside the transaction so the number-allocating lock is
  // held for the shortest possible time (see allocateRef).
  const src = await prisma.quotation.findUnique({ where: { id }, include: quotationInclude });
  if (!src) throw new QuotationValidationError("Quotation not found");

  return prisma.$transaction(async (tx) => {
    const ref = await allocateRef(tx);
    const created = await tx.quotation.create({
      data: {
        ref,
        date: new Date(),
        customerId: src.customerId,
        client: src.client,
        billing: src.billing,
        delivery: src.delivery,
        title: src.title,
        refBy: src.refBy,
        salesPerson: src.salesPerson,
        status: "DRAFT",
        validityDays: src.validityDays,
        discountPct: src.discountPct,
        installMode: src.installMode,
        installBasis: src.installBasis,
        installValue: src.installValue,
        transportMode: src.transportMode,
        transportAmount: src.transportAmount,
        gstMode: src.gstMode,
        gstPct: src.gstPct,
        roundTo: src.roundTo,
        note: src.note,
        terms: src.terms,
        showDetails: src.showDetails,
        areaTotalsWithGst: src.areaTotalsWithGst,
        sections: src.sections,
        subtotal: src.subtotal,
        discountAmount: src.discountAmount,
        netAmount: src.netAmount,
        installAmount: src.installAmount,
        roundedAmount: src.roundedAmount,
        gstAmount: src.gstAmount,
        grandTotal: src.grandTotal,
        items: {
          create: src.items.map((i) => ({
            catalogItemId: i.catalogItemId,
            section: i.section,
            description: i.description,
            makes: i.makes,
            unit: i.unit,
            qty: i.qty,
            rate: i.rate,
            discPct: i.discPct,
            sortOrder: i.sortOrder,
          })),
        },
      },
      include: quotationInclude,
    });
    return toDto(created);
  }, TX_OPTS);
}

// Converts an accepted quotation into a live project.
//
// Everything happens in one transaction: if any part fails, no project is
// created and the quotation stays convertible. Line rates are carried across
// NET of discount and of any rounding, so the project's contract value equals
// the figure the client actually accepted; installation becomes its own line.
export async function convertToProject(id: string): Promise<{ projectId: string }> {
  return prisma.$transaction(async (tx) => {
    const q = await tx.quotation.findUnique({ where: { id }, include: quotationInclude });
    if (!q) throw new QuotationValidationError("Quotation not found");
    if (q.convertedProjectId) {
      throw new QuotationConflictError("This quotation has already been converted into a project.");
    }
    const usable = q.items.filter((i) => i.description.trim() && toNum(i.qty) > 0);
    if (!usable.length) {
      throw new QuotationValidationError("Add at least one item with a quantity before converting to a project.");
    }

    const terms = toQuoteTerms(q);
    const totals = quoteTotals(terms, toQuoteLines(q.items));
    // Rounding factor: spreads a hard-rounded grand total back across the line
    // rates so the sales order's own arithmetic reproduces the accepted price.
    const roundFactor = totals.grandBeforeRounding > 0 ? totals.roundedAmount / totals.grandBeforeRounding : 1;

    const customerId = q.customerId ?? (await ensureCustomer(q.client, tx))?.id ?? null;

    const project = await tx.project.create({
      data: {
        name: q.title.trim(),
        client: q.client.trim(),
        customerId,
        refBy: q.refBy,
        salesPerson: q.salesPerson,
        site: q.delivery,
        type: "MIXED_SCOPE",
        status: "IN_PROGRESS",
        approvalMode: "QUOTE_VERBAL",
        approvalBasisNote: `Converted from quotation ${q.ref}`,
        poNumber: q.ref,
        poDate: q.date,
        termsGst: q.gstMode === "INCLUDED" ? "INCLUDED" : "EXTRA",
        termsTransport: q.transportMode === "EXTRA" ? "EXTRA" : "INCLUDED",
        items: {
          create: [
            ...usable.map((i, idx) => ({
              description: i.description.trim(),
              make: (i.makes[0] ?? "").trim(),
              unit: i.unit || "Nos",
              qty: toNum(i.qty),
              rate: Math.round(
                lineNetRate(terms, {
                  qty: toNum(i.qty),
                  rate: toNum(i.rate),
                  discPct: i.discPct === null ? null : toNum(i.discPct),
                }) *
                  roundFactor *
                  100
              ) / 100,
              sortOrder: idx,
            })),
            ...(totals.installAmount > 0
              ? [
                  {
                    description: "Installation of Equipment",
                    make: "",
                    unit: "LS",
                    qty: 1,
                    rate: Math.round(totals.installAmount * roundFactor * 100) / 100,
                    sortOrder: usable.length,
                  },
                ]
              : []),
          ],
        },
      },
    });

    await tx.quotation.update({
      where: { id },
      data: { status: "CONVERTED", convertedProjectId: project.id, convertedAt: new Date() },
    });

    await tx.activityLog.create({
      data: {
        projectId: project.id,
        entity: "Quotation",
        entityId: q.id,
        action: "IMPORT",
        summary: `Project created from quotation ${q.ref}`,
        metadata: { quotationRef: q.ref, grandTotal: totals.grandTotal },
      },
    });

    return { projectId: project.id };
  }, TX_OPTS);
}
