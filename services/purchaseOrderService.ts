import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { toNum } from "../lib/decimal";
import { normKey } from "./stockService";
import type { PoUpdateInput } from "../modules/purchase/schema";

// Purchase Orders — ported from the prototype's poTotals / renderPo /
// postPoReceipt / poDocHTML.

export class PoValidationError extends Error {}

const TX_OPTS = { timeout: 20_000, maxWait: 20_000 } as const;

const poInclude = {
  vendor: true,
  rfq: { select: { id: true, no: true } },
  lines: { orderBy: { sortOrder: "asc" } },
} as const;

type PoRow = Prisma.PurchaseOrderGetPayload<{ include: typeof poInclude }>;

export interface PoTotals {
  basic: number;
  gst: number;
  transport: number;
  transportGst: number;
  total: number;
}

/** Ported from poTotals(o) exactly. */
export function poTotals(o: {
  lines: { qty: number; rate: number; gst: number }[];
  transport: number;
  transportGstPct: number;
}): PoTotals {
  const basic = o.lines.reduce((t, l) => t + l.qty * l.rate, 0);
  const gst = o.lines.reduce((t, l) => t + (l.qty * l.rate * l.gst) / 100, 0);
  const transport = o.transport;
  const transportGst = (transport * o.transportGstPct) / 100;
  return { basic, gst, transport, transportGst, total: basic + gst + transport + transportGst };
}

export interface PoLineDto {
  id: string;
  name: string;
  make: string;
  unit: string;
  qty: number;
  rate: number;
  gst: number;
  remark: string;
  projectNames: string[];
  receivedQty: number;
}

export interface PoDetail {
  id: string;
  poNumber: string;
  date: string;
  status: string;
  vendor: { id: string; name: string; contact: string | null; address: string | null; gstin: string | null };
  rfq: { id: string; no: string } | null;
  transport: number;
  transportGstPct: number;
  transportNote: string;
  delivery: string;
  payment: string;
  deliverTo: string;
  remarks: string;
  lines: PoLineDto[];
  totals: PoTotals;
}

function toDto(o: PoRow): PoDetail {
  const lines: PoLineDto[] = o.lines.map((l) => ({
    id: l.id,
    name: l.description,
    make: l.make,
    unit: l.unit,
    qty: toNum(l.qty),
    rate: toNum(l.unitPrice),
    gst: toNum(l.taxPct),
    remark: l.remark ?? "",
    projectNames: l.projectNames,
    receivedQty: toNum(l.receivedQty),
  }));
  return {
    id: o.id,
    poNumber: o.poNumber,
    date: o.poDate.toISOString().slice(0, 10),
    status: o.status,
    vendor: {
      id: o.vendor.id,
      name: o.vendor.name,
      contact: o.vendor.contact,
      address: o.vendor.address,
      gstin: o.vendor.gstin,
    },
    rfq: o.rfq ? { id: o.rfq.id, no: o.rfq.no } : null,
    transport: toNum(o.transport),
    transportGstPct: toNum(o.transportGst),
    transportNote: o.transportNote ?? "",
    delivery: o.delivery ?? "",
    payment: o.payment ?? "",
    deliverTo: o.deliverTo ?? "",
    remarks: o.remarks ?? "",
    lines,
    totals: poTotals({ lines, transport: toNum(o.transport), transportGstPct: toNum(o.transportGst) }),
  };
}

export async function getPurchaseOrder(id: string): Promise<PoDetail | null> {
  const o = await prisma.purchaseOrder.findUnique({ where: { id }, include: poInclude });
  return o ? toDto(o) : null;
}

export interface PoListRow {
  id: string;
  poNumber: string;
  date: string;
  vendorName: string;
  rfqNo: string | null;
  total: number;
  status: string;
}

export async function listPurchaseOrders(): Promise<PoListRow[]> {
  const rows = await prisma.purchaseOrder.findMany({
    orderBy: { createdAt: "desc" },
    include: poInclude,
  });
  return rows.map((o) => {
    const dto = toDto(o);
    return {
      id: dto.id,
      poNumber: dto.poNumber,
      date: dto.date,
      vendorName: dto.vendor.name,
      rfqNo: dto.rfq?.no ?? null,
      total: dto.totals.total,
      status: dto.status,
    };
  });
}

/** Recomputes and stores the header money columns from the current lines. */
async function refreshTotals(tx: Prisma.TransactionClient, poId: string): Promise<void> {
  const o = await tx.purchaseOrder.findUnique({ where: { id: poId }, include: { lines: true } });
  if (!o) return;
  const t = poTotals({
    lines: o.lines.map((l) => ({ qty: toNum(l.qty), rate: toNum(l.unitPrice), gst: toNum(l.taxPct) })),
    transport: toNum(o.transport),
    transportGstPct: toNum(o.transportGst),
  });
  await tx.purchaseOrder.update({
    where: { id: poId },
    data: { subtotal: t.basic, taxAmount: t.gst, totalAmount: t.total },
  });
}

export async function updatePurchaseOrder(id: string, input: PoUpdateInput): Promise<PoDetail> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.purchaseOrder.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new PoValidationError("Purchase order not found");

    if (input.lines?.length) {
      for (const l of input.lines) {
        await tx.poLineItem.update({
          where: { id: l.id },
          data: {
            ...(l.qty !== undefined ? { qty: l.qty } : {}),
            ...(l.rate !== undefined ? { unitPrice: l.rate } : {}),
            ...(l.gst !== undefined ? { taxPct: l.gst } : {}),
            ...(l.qty !== undefined || l.rate !== undefined
              ? { total: (l.qty ?? 0) * (l.rate ?? 0) }
              : {}),
          },
        });
      }
    }

    await tx.purchaseOrder.update({
      where: { id },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.transport !== undefined ? { transport: input.transport } : {}),
        ...(input.transportGst !== undefined ? { transportGst: input.transportGst } : {}),
        ...(input.delivery !== undefined ? { delivery: input.delivery || null } : {}),
        ...(input.payment !== undefined ? { payment: input.payment || null } : {}),
        ...(input.deliverTo !== undefined ? { deliverTo: input.deliverTo || null } : {}),
        ...(input.remarks !== undefined ? { remarks: input.remarks || null } : {}),
      },
    });

    await refreshTotals(tx, id);
  }, TX_OPTS);

  const updated = await getPurchaseOrder(id);
  if (!updated) throw new PoValidationError("Purchase order not found");
  return updated;
}

/**
 * Records received quantity against a PO line and posts the movement to stock.
 *
 * Ported from postPoReceipt(o, lineId, qty). `receivedQty` is the TOTAL
 * received to date, and only the DIFFERENCE from what was already recorded is
 * written to stock — so saving the same figure twice is a no-op and a receipt
 * can never be double-counted. Correcting a number downwards posts a negative
 * adjustment rather than silently rewriting history.
 *
 * The stock entry carries type/rate/vendor/ref, which is exactly what
 * "last purchase price" and both costing sheets read.
 */
export async function postPoReceipt(
  poId: string,
  lineId: string,
  receivedQty: number
): Promise<{ delta: number; status: string }> {
  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: poId },
      include: { vendor: true, lines: true },
    });
    if (!po) throw new PoValidationError("Purchase order not found");

    const line = po.lines.find((l) => l.id === lineId);
    if (!line) throw new PoValidationError("That line is not on this purchase order.");
    if (receivedQty < 0) throw new PoValidationError("Received quantity cannot be negative.");

    const previous = toNum(line.receivedQty);
    const delta = receivedQty - previous;

    await tx.poLineItem.update({ where: { id: lineId }, data: { receivedQty } });

    if (delta !== 0) {
      const key = normKey(line.description, line.make, line.unit);
      let master = await tx.itemMaster.findUnique({ where: { normKey: key } });
      if (!master) {
        master = await tx.itemMaster.create({
          data: { name: line.description, make: line.make, unit: line.unit, normKey: key },
        });
      }
      await tx.stockEntry.create({
        data: {
          itemMasterId: master.id,
          date: new Date(),
          qty: delta,
          // A downward correction is an outward adjustment, not a purchase —
          // otherwise it would pollute the last-purchase price with a negative.
          type: delta > 0 ? "PURCHASE" : "ADJUST_OUT",
          rate: delta > 0 ? line.unitPrice : null,
          vendor: delta > 0 ? po.vendor.name : null,
          ref: `PO ${po.poNumber}`,
          note: delta > 0 ? "Received against PO" : "Receipt correction",
        },
      });
    }

    // Status follows receipts, exactly as the prototype does, unless the PO was
    // cancelled — a cancelled order is not resurrected by a stray receipt.
    const lines = po.lines.map((l) => ({
      qty: toNum(l.qty),
      received: l.id === lineId ? receivedQty : toNum(l.receivedQty),
    }));
    const allIn = lines.every((l) => l.received >= l.qty);
    const anyIn = lines.some((l) => l.received > 0);
    let status = po.status;
    if (po.status !== "CANCELLED") status = allIn ? "COMPLETED" : anyIn ? "PARTIALLY_RECEIVED" : "ISSUED";
    if (status !== po.status) await tx.purchaseOrder.update({ where: { id: poId }, data: { status } });

    return { delta, status };
  }, TX_OPTS);
}
