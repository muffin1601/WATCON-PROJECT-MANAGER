import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { toNum } from "../lib/decimal";
import { normKey } from "./stockService";
import { dispatchedQty } from "./financials";
import type { RfqInput, RfqResponseInput } from "../modules/purchase/schema";

// Rate Inquiry — ported from the prototype's rfqCandidates / newRfqWizard /
// rfqCompare / importRfqReplies / issuePoFromRfq.

export class RfqValidationError extends Error {}
export class RfqConflictError extends Error {}

// Same reasoning as quotation numbering: the settings row lock serializes
// concurrent creates, so the transaction around it stays tiny and gets room to
// drain on a WAN-remote database.
const TX_OPTS = { timeout: 20_000, maxWait: 20_000 } as const;

async function allocateRfqNo(tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<{ rfqPrefix: string; rfqNext: number }[]>`
    UPDATE "settings"
       SET "rfqNext" = "rfqNext" + 1, "updatedAt" = NOW()
     WHERE "key" = 'default'
    RETURNING "rfqPrefix", "rfqNext" - 1 AS "rfqNext"
  `;
  const row = rows[0];
  if (!row) throw new RfqValidationError("Settings row is missing — open Settings once and save it.");
  return `${row.rfqPrefix}${String(row.rfqNext).padStart(3, "0")}`;
}

async function allocatePoNo(tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<{ poPrefix: string; poNext: number }[]>`
    UPDATE "settings"
       SET "poNext" = "poNext" + 1, "updatedAt" = NOW()
     WHERE "key" = 'default'
    RETURNING "poPrefix", "poNext" - 1 AS "poNext"
  `;
  const row = rows[0];
  if (!row) throw new RfqValidationError("Settings row is missing — open Settings once and save it.");
  return `${row.poPrefix}${String(row.poNext).padStart(3, "0")}`;
}

// ---------- Step 2 candidates ----------

export interface RfqCandidate {
  key: string;
  name: string;
  make: string;
  unit: string;
  category: string;
  required: number;
  stock: number;
  toOrder: number;
  projects: string[];
}

/**
 * Ported from rfqCandidates(projectIds): for each Sales Order item still
 * undelivered on the selected projects, aggregate the pending quantity per
 * item+make+unit and net it against current stock.
 */
export async function rfqCandidates(projectIds: string[]): Promise<RfqCandidate[]> {
  if (!projectIds.length) return [];

  const [projects, masters, catalog] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: {
        name: true,
        items: { select: { id: true, description: true, make: true, unit: true, qty: true } },
        challans: { select: { date: true, items: { select: { itemId: true, qty: true, extraQty: true } } } },
      },
    }),
    prisma.itemMaster.findMany({
      select: {
        normKey: true,
        entries: { select: { qty: true } },
        name: true,
        make: true,
        unit: true,
      },
    }),
    prisma.catalogItem.findMany({ select: { normName: true, category: true } }),
  ]);

  const categoryByName = new Map(catalog.map((c) => [c.normName, c.category ?? ""]));

  // Stock in per master row. Current stock also subtracts what has gone out to
  // sites; that needs every project, so it is computed below from the same
  // dispatch data used for "required".
  const stockInByKey = new Map<string, number>();
  masters.forEach((m) => {
    stockInByKey.set(m.normKey, m.entries.reduce((t, e) => t + toNum(e.qty), 0));
  });

  // Dispatched-to-site totals across ALL projects, so "in stock" means the same
  // thing here as it does on the Items & Stocks screen.
  const allProjects = await prisma.project.findMany({
    select: {
      items: { select: { id: true, description: true, make: true, unit: true } },
      challans: { select: { items: { select: { itemId: true, qty: true, extraQty: true } } } },
    },
  });
  const deliveredByKey = new Map<string, number>();
  allProjects.forEach((p) => {
    const byItem = new Map<string, number>();
    p.challans.forEach((c) =>
      c.items.forEach((ci) => byItem.set(ci.itemId, (byItem.get(ci.itemId) ?? 0) + toNum(ci.qty) + toNum(ci.extraQty)))
    );
    p.items.forEach((it) => {
      const d = byItem.get(it.id) ?? 0;
      if (!d) return;
      const key = normKey(it.description, it.make, it.unit);
      deliveredByKey.set(key, (deliveredByKey.get(key) ?? 0) + d);
    });
  });

  const map = new Map<string, RfqCandidate>();

  projects.forEach((p) => {
    // Dispatch per item on THIS project, for the pending calculation.
    const fin = {
      challans: p.challans.map((c) => ({
        id: "",
        date: c.date.toISOString().slice(0, 10),
        items: c.items.map((ci) => ({ itemId: ci.itemId, qty: toNum(ci.qty), extraQty: toNum(ci.extraQty) })),
        extraItems: [],
      })),
    };

    p.items.forEach((it) => {
      const pending = Math.max(toNum(it.qty) - dispatchedQty(fin, it.id), 0);
      if (pending <= 0) return;
      const key = normKey(it.description, it.make, it.unit);
      let row = map.get(key);
      if (!row) {
        row = {
          key,
          name: it.description,
          make: it.make ?? "",
          unit: it.unit,
          category: categoryByName.get(it.description.trim().toLowerCase().replace(/\s+/g, " ")) ?? "",
          required: 0,
          stock: 0,
          toOrder: 0,
          projects: [],
        };
        map.set(key, row);
      }
      row.required += pending;
      if (!row.projects.includes(p.name)) row.projects.push(p.name);
    });
  });

  return [...map.values()]
    .map((c) => {
      const stock = Math.max((stockInByKey.get(c.key) ?? 0) - (deliveredByKey.get(c.key) ?? 0), 0);
      return { ...c, stock, toOrder: Math.max(c.required - stock, 0) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- Create ----------

export async function createRfq(input: RfqInput): Promise<{ id: string; no: string }> {
  const vendors = await prisma.vendor.findMany({ where: { id: { in: input.vendorIds } }, select: { id: true } });
  if (vendors.length !== input.vendorIds.length) {
    throw new RfqValidationError("One of the selected suppliers no longer exists.");
  }

  return prisma.$transaction(async (tx) => {
    const no = await allocateRfqNo(tx);
    const rfq = await tx.rfq.create({
      data: {
        no,
        date: new Date(input.date),
        due: input.due ? new Date(input.due) : null,
        deliverTo: input.deliverTo || null,
        note: input.note || null,
        status: "SENT",
        projectIds: input.projectIds,
        lines: {
          create: input.lines.map((l, i) => ({
            name: l.name,
            make: l.make,
            unit: l.unit,
            category: l.category || null,
            required: l.required,
            stock: l.stock,
            qty: l.qty,
            projectNames: l.projectNames,
            sortOrder: i,
          })),
        },
        vendors: { create: input.vendorIds.map((vendorId) => ({ vendorId })) },
      },
      select: { id: true, no: true },
    });
    return rfq;
  }, TX_OPTS);
}

// ---------- Read ----------

const rfqInclude = {
  lines: { orderBy: { sortOrder: "asc" } },
  vendors: { include: { vendor: true } },
  responses: { include: { vendor: true, offers: true } },
  purchaseOrders: { select: { id: true, poNumber: true, vendorId: true } },
} as const;

type RfqRow = Prisma.RfqGetPayload<{ include: typeof rfqInclude }>;

export interface RfqOfferView {
  vendorId: string;
  rate: number | null;
  gst: number;
  landed: number;
  remark: string;
}

export interface RfqRowView {
  lineId: string;
  name: string;
  make: string;
  unit: string;
  category: string | null;
  required: number;
  stock: number;
  qty: number;
  projectNames: string[];
  offers: RfqOfferView[];
  /** Vendor with the lowest landed rate, or null when nobody quoted. */
  best: string | null;
  chosen: string | null;
}

export interface RfqVendorTotals {
  basic: number;
  gst: number;
  transport: number;
  transportGst: number;
  total: number;
  quoted: number;
}

export interface RfqDetail {
  id: string;
  no: string;
  date: string;
  due: string | null;
  deliverTo: string;
  note: string;
  status: string;
  projectIds: string[];
  projectNames: string[];
  vendors: { id: string; name: string; contact: string | null; phone: string | null }[];
  responses: Record<
    string,
    {
      quotedBy: string;
      ref: string;
      filledAt: string | null;
      transport: number;
      transportGst: number;
      transportNote: string;
      delivery: string;
      payment: string;
      remarks: string;
      manual: boolean;
    }
  >;
  rows: RfqRowView[];
  totals: Record<string, RfqVendorTotals>;
  /** Vendor ids that already have a PO issued from this inquiry. */
  posByVendor: Record<string, { id: string; poNumber: string }>;
  lineCount: number;
}

/** Ported from rfqCompare(r) — landed rate = rate x (1 + gst/100). */
function buildCompare(r: RfqRow): Pick<RfqDetail, "rows" | "totals"> {
  const respondedVendorIds = r.responses.map((x) => x.vendorId);

  const rows: RfqRowView[] = r.lines.map((l) => {
    const offers: RfqOfferView[] = respondedVendorIds.map((vendorId) => {
      const resp = r.responses.find((x) => x.vendorId === vendorId)!;
      const offer = resp.offers.find((o) => o.lineId === l.id);
      if (!offer || offer.rate === null) return { vendorId, rate: null, gst: 0, landed: 0, remark: "" };
      const rate = toNum(offer.rate);
      const gst = toNum(offer.gstPct);
      return { vendorId, rate, gst, landed: rate * (1 + gst / 100), remark: offer.remark ?? "" };
    });
    const valid = offers.filter((o) => o.rate !== null);
    const best = valid.length ? valid.reduce((a, b) => (b.landed < a.landed ? b : a)).vendorId : null;
    return {
      lineId: l.id,
      name: l.name,
      make: l.make,
      unit: l.unit,
      category: l.category,
      required: toNum(l.required),
      stock: toNum(l.stock),
      qty: toNum(l.qty),
      projectNames: l.projectNames,
      offers,
      best,
      chosen: l.chosenVendorId,
    };
  });

  const totals: Record<string, RfqVendorTotals> = {};
  respondedVendorIds.forEach((vendorId) => {
    const resp = r.responses.find((x) => x.vendorId === vendorId)!;
    let basic = 0;
    let gst = 0;
    let quoted = 0;
    r.lines.forEach((l) => {
      const offer = resp.offers.find((o) => o.lineId === l.id);
      if (!offer || offer.rate === null) return;
      const qty = toNum(l.qty);
      const rate = toNum(offer.rate);
      basic += qty * rate;
      gst += (qty * rate * toNum(offer.gstPct)) / 100;
      quoted += 1;
    });
    const transport = toNum(resp.transport);
    const transportGst = (transport * toNum(resp.transportGst)) / 100;
    totals[vendorId] = { basic, gst, transport, transportGst, total: basic + gst + transport + transportGst, quoted };
  });

  return { rows, totals };
}

export async function getRfqDetail(id: string): Promise<RfqDetail | null> {
  const r = await prisma.rfq.findUnique({ where: { id }, include: rfqInclude });
  if (!r) return null;

  const projects = await prisma.project.findMany({
    where: { id: { in: r.projectIds } },
    select: { id: true, name: true },
  });

  const { rows, totals } = buildCompare(r);

  const posByVendor: RfqDetail["posByVendor"] = {};
  r.purchaseOrders.forEach((po) => {
    posByVendor[po.vendorId] = { id: po.id, poNumber: po.poNumber };
  });

  const responses: RfqDetail["responses"] = {};
  r.responses.forEach((resp) => {
    responses[resp.vendorId] = {
      quotedBy: resp.quotedBy ?? "",
      ref: resp.ref ?? "",
      filledAt: resp.filledAt ? resp.filledAt.toISOString() : null,
      transport: toNum(resp.transport),
      transportGst: toNum(resp.transportGst),
      transportNote: resp.transportNote ?? "",
      delivery: resp.delivery ?? "",
      payment: resp.payment ?? "",
      remarks: resp.remarks ?? "",
      manual: resp.manual,
    };
  });

  return {
    id: r.id,
    no: r.no,
    date: r.date.toISOString().slice(0, 10),
    due: r.due ? r.due.toISOString().slice(0, 10) : null,
    deliverTo: r.deliverTo ?? "",
    note: r.note ?? "",
    status: r.status,
    projectIds: r.projectIds,
    projectNames: projects.map((p) => p.name),
    vendors: r.vendors.map((v) => ({
      id: v.vendor.id,
      name: v.vendor.name,
      contact: v.vendor.contact,
      phone: v.vendor.phone,
    })),
    responses,
    rows,
    totals,
    posByVendor,
    lineCount: r.lines.length,
  };
}

export interface RfqListRow {
  id: string;
  no: string;
  date: string;
  projectNames: string[];
  lineCount: number;
  vendorCount: number;
  responseCount: number;
  status: string;
}

export async function listRfqs(): Promise<RfqListRow[]> {
  const rows = await prisma.rfq.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      no: true,
      date: true,
      status: true,
      projectIds: true,
      _count: { select: { lines: true, vendors: true, responses: true } },
    },
  });
  const allIds = [...new Set(rows.flatMap((r) => r.projectIds))];
  const projects = await prisma.project.findMany({ where: { id: { in: allIds } }, select: { id: true, name: true } });
  const nameById = new Map(projects.map((p) => [p.id, p.name]));

  return rows.map((r) => ({
    id: r.id,
    no: r.no,
    date: r.date.toISOString().slice(0, 10),
    projectNames: r.projectIds.map((id) => nameById.get(id)).filter((n): n is string => !!n),
    lineCount: r._count.lines,
    vendorCount: r._count.vendors,
    responseCount: r._count.responses,
    status: r.status,
  }));
}

// ---------- Supplier replies ----------

/** Adds a supplier to an existing inquiry (prototype's "+ Add supplier"). */
export async function addRfqVendors(rfqId: string, vendorIds: string[]): Promise<void> {
  if (!vendorIds.length) return;
  await prisma.rfqVendor.createMany({
    data: vendorIds.map((vendorId) => ({ rfqId, vendorId })),
    skipDuplicates: true,
  });
}

/**
 * Stores one supplier's reply. Replacing an existing reply is allowed (the
 * supplier re-sends a corrected file) and is done as delete-then-create inside
 * a transaction so a half-applied revision cannot survive.
 */
export async function saveRfqResponse(rfqId: string, input: RfqResponseInput): Promise<void> {
  const rfq = await prisma.rfq.findUnique({
    where: { id: rfqId },
    select: { id: true, status: true, lines: { select: { id: true } } },
  });
  if (!rfq) throw new RfqValidationError("Rate inquiry not found");

  const validLineIds = new Set(rfq.lines.map((l) => l.id));
  const offers = input.items.filter((o) => validLineIds.has(o.lineId));

  await prisma.$transaction(async (tx) => {
    // The supplier must be on the inquiry for their reply to belong to it.
    await tx.rfqVendor.upsert({
      where: { rfqId_vendorId: { rfqId, vendorId: input.vendorId } },
      create: { rfqId, vendorId: input.vendorId },
      update: {},
    });

    await tx.rfqResponse.deleteMany({ where: { rfqId, vendorId: input.vendorId } });
    await tx.rfqResponse.create({
      data: {
        rfqId,
        vendorId: input.vendorId,
        quotedBy: input.quotedBy || null,
        contact: input.contact || null,
        ref: input.ref || null,
        validity: input.validity ?? null,
        transport: input.transport,
        transportGst: input.transportGst,
        transportNote: input.transportNote || null,
        delivery: input.delivery || null,
        payment: input.payment || null,
        remarks: input.remarks || null,
        manual: input.manual,
        filledAt: input.filledAt ? new Date(input.filledAt) : new Date(),
        offers: {
          create: offers.map((o) => ({ lineId: o.lineId, rate: o.rate, gstPct: o.gst, remark: o.remark || null })),
        },
      },
    });

    // Once a reply is in, the inquiry is being compared — unless POs are done.
    if (rfq.status === "SENT") await tx.rfq.update({ where: { id: rfqId }, data: { status: "COMPARING" } });
  }, TX_OPTS);
}

export async function deleteRfqResponse(rfqId: string, vendorId: string): Promise<void> {
  await prisma.rfqResponse.deleteMany({ where: { rfqId, vendorId } });
}

/** Per-line supplier choice on the comparison sheet. */
export async function setRfqSelection(rfqId: string, lineId: string, vendorId: string | null): Promise<void> {
  const line = await prisma.rfqLine.findFirst({ where: { id: lineId, rfqId }, select: { id: true } });
  if (!line) throw new RfqValidationError("That line is not on this inquiry.");
  await prisma.$transaction(async (tx) => {
    await tx.rfqLine.update({ where: { id: lineId }, data: { chosenVendorId: vendorId } });
    const rfq = await tx.rfq.findUnique({ where: { id: rfqId }, select: { status: true } });
    if (rfq && rfq.status === "SENT") await tx.rfq.update({ where: { id: rfqId }, data: { status: "COMPARING" } });
  }, TX_OPTS);
}

/** "Select lowest for all" — ported from the prototype's rfAutoBest button. */
export async function selectLowestForAll(rfqId: string): Promise<number> {
  const detail = await getRfqDetail(rfqId);
  if (!detail) throw new RfqValidationError("Rate inquiry not found");
  const updates = detail.rows.filter((r) => r.best);
  await prisma.$transaction(async (tx) => {
    for (const r of updates) {
      await tx.rfqLine.update({ where: { id: r.lineId }, data: { chosenVendorId: r.best } });
    }
  }, TX_OPTS);
  if (updates.length) {
    await prisma.rfq.updateMany({ where: { id: rfqId, status: "SENT" }, data: { status: "COMPARING" } });
  }
  return updates.length;
}

// ---------- Issue a purchase order ----------

/**
 * Ported from issuePoFromRfq(r, vid): every line whose chosen supplier is this
 * vendor becomes a PO line at that vendor's quoted rate and GST, carrying their
 * transport and delivery/payment terms. One PO per supplier per inquiry.
 */
export async function issuePoFromRfq(rfqId: string, vendorId: string): Promise<{ id: string; poNumber: string }> {
  const detail = await getRfqDetail(rfqId);
  if (!detail) throw new RfqValidationError("Rate inquiry not found");
  if (detail.posByVendor[vendorId]) {
    throw new RfqConflictError("A purchase order has already been issued to this supplier from this inquiry.");
  }

  const rows = detail.rows.filter((r) => r.chosen === vendorId);
  if (!rows.length) throw new RfqValidationError("No items are assigned to this supplier.");

  const resp = detail.responses[vendorId];
  const settings = await prisma.setting.findUnique({ where: { key: "default" }, select: { address: true } });

  const result = await prisma.$transaction(async (tx) => {
    const poNumber = await allocatePoNo(tx);

    let subtotal = 0;
    let taxAmount = 0;
    const lines = rows.map((r, i) => {
      const offer = r.offers.find((o) => o.vendorId === vendorId);
      const rate = offer?.rate ?? 0;
      const gst = offer?.gst ?? 0;
      const total = r.qty * rate;
      subtotal += total;
      taxAmount += (total * gst) / 100;
      return {
        description: r.name,
        make: r.make,
        unit: r.unit,
        qty: r.qty,
        unitPrice: rate,
        taxPct: gst,
        total,
        remark: offer?.remark || null,
        projectNames: r.projectNames,
        sortOrder: i,
      };
    });

    const transport = resp?.transport ?? 0;
    const transportGstAmt = (transport * (resp?.transportGst ?? 0)) / 100;

    const po = await tx.purchaseOrder.create({
      data: {
        poNumber,
        vendorId,
        rfqId,
        status: "ISSUED",
        poDate: new Date(),
        transport,
        transportGst: resp?.transportGst ?? 0,
        transportNote: resp?.transportNote || null,
        delivery: resp?.delivery || null,
        payment: resp?.payment || null,
        deliverTo: detail.deliverTo || settings?.address || null,
        remarks:
          `Against your quotation` +
          (resp?.ref ? ` ref ${resp.ref}` : "") +
          (resp?.filledAt ? ` dt ${resp.filledAt.slice(0, 10)}` : "") +
          ".",
        subtotal,
        taxAmount,
        totalAmount: subtotal + taxAmount + transport + transportGstAmt,
        lines: { create: lines },
      },
      select: { id: true, poNumber: true },
    });

    return po;
  }, TX_OPTS);

  // The inquiry is done once every chosen line is covered by a PO.
  const after = await getRfqDetail(rfqId);
  if (after) {
    const allCovered = after.rows.every((r) => !r.chosen || !!after.posByVendor[r.chosen]);
    if (allCovered) await prisma.rfq.update({ where: { id: rfqId }, data: { status: "PO_ISSUED" } });
  }

  return result;
}
