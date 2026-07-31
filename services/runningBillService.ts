import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { toNum } from "../lib/decimal";
import {
  customDispatched,
  discountTotal,
  dispatchedQty,
  extraQtyOf,
  type FinProject,
} from "./financials";
import { ValidationError } from "./challanService";
import type { GenerateBillInput } from "../modules/challans/schema";

interface BillLineDraft {
  description: string;
  unit: string | null;
  orderQty: number | null;
  cumQty: number | null;
  rate: number | null;
  amount: number;
  isExtra: boolean;
}

// Ported EXACTLY from generateBill(p) in the prototype: section A (Sales
// Order items dispatched to date) + zoho manual-value challans + section B
// (extras beyond BOQ), then gross/discount/GST/prior-billed/net-payable.
export async function generateRunningBill(projectId: string, input: GenerateBillInput) {
  const [project, settings] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      include: {
        items: true,
        challans: { include: { items: true, extraItems: true } },
        discounts: true,
        bills: true,
      },
    }),
    prisma.setting.findUnique({ where: { key: "default" } }),
  ]);
  if (!project) throw new ValidationError("Project not found");
  if (!settings) throw new ValidationError("Settings not configured");

  const fin: FinProject = {
    items: project.items.map((i) => ({ id: i.id, description: i.description, unit: i.unit, qty: toNum(i.qty), rate: toNum(i.rate) })),
    challans: project.challans.map((c) => ({
      id: c.id,
      date: c.date.toISOString().slice(0, 10),
      manualValue: c.manualValue ? toNum(c.manualValue) : null,
      items: c.items.map((ci) => ({ itemId: ci.itemId, qty: toNum(ci.qty), extraQty: toNum(ci.extraQty) })),
      extraItems: c.extraItems.map((x) => ({ description: x.description, unit: x.unit, qty: toNum(x.qty), rate: toNum(x.rate) })),
    })),
    discounts: project.discounts.map((d) => ({ amount: toNum(d.amount) })),
    amendments: [],
    terms: { gst: project.termsGst === "EXTRA" ? "extra" : "included" },
  };

  const upto = input.uptoDate;
  const lines: BillLineDraft[] = [];

  fin.items.forEach((it) => {
    const cq = dispatchedQty(fin, it.id, upto);
    if (cq > 0) {
      lines.push({ description: it.description, unit: it.unit, orderQty: it.qty, cumQty: cq, rate: it.rate, amount: cq * it.rate, isExtra: false });
    }
  });

  let zoho = 0;
  fin.challans.forEach((c) => {
    if (c.date <= upto && c.manualValue) zoho += Number(c.manualValue) || 0;
  });
  if (zoho > 0) {
    lines.push({
      description: "Material supplied vide attached Zoho challans (value basis)",
      unit: "LS",
      orderQty: null,
      cumQty: null,
      rate: null,
      amount: zoho,
      isExtra: false,
    });
  }

  fin.items.forEach((it) => {
    const eq = extraQtyOf(fin, it.id, upto);
    if (eq > 0) {
      lines.push({ description: it.description, unit: it.unit, orderQty: null, cumQty: eq, rate: it.rate, amount: eq * it.rate, isExtra: true });
    }
  });
  customDispatched(fin, upto).forEach((x) => {
    if (x.qty > 0) {
      lines.push({ description: x.description, unit: x.unit, orderQty: null, cumQty: x.qty, rate: x.rate, amount: x.qty * (x.rate || 0), isExtra: true });
    }
  });

  if (!lines.length) {
    throw new ValidationError("No challans found up to this date — nothing to bill.");
  }

  const grossBasic = lines.reduce((s, l) => s + l.amount, 0);
  const priorDisc = project.bills.reduce((s, b) => s + toNum(b.discountApplied), 0);
  const discCum = input.applyDiscount ? discountTotal(fin) : priorDisc;
  const discNow = Math.max(discCum - priorDisc, 0);
  const gstRatePct = toNum(settings.gstRatePct);
  const gst = fin.terms.gst === "extra" ? (grossBasic - discCum) * (gstRatePct / 100) : 0;
  const grossToDate = grossBasic - discCum + gst;
  const priorBilled = project.bills.reduce((s, b) => s + toNum(b.netPayable), 0);
  const netPayable = grossToDate - priorBilled;

  if (netPayable <= 0) {
    throw new ValidationError("Everything dispatched up to this date is already billed.");
  }

  // Numbering matches the prototype exactly: billPrefix + (count of bills
  // so far + 1) + " / " + PO ref. The prototype's in-memory array had no
  // uniqueness constraint, so this could never collide there; the DB's
  // `[projectId, no]` unique constraint (a data-integrity improvement over
  // the prototype) can collide if a bill was deleted out of order and a new
  // one generated afterward (e.g. delete RA-1 while RA-2 exists, generate
  // again → "RA-2" is already taken). Retry with the next integer rather
  // than changing the numbering formula or crashing.
  let attempt = project.bills.length + 1;
  for (let tries = 0; tries < 20; tries++) {
    const no = `${settings.billPrefix}${attempt} / ${project.poNumber || project.name}`;
    try {
      return await prisma.bill.create({
        data: {
          projectId,
          no,
          date: new Date(upto),
          grossBasic,
          discountApplied: discNow,
          discountCum: discCum,
          gst,
          grossToDate,
          priorBilled,
          netPayable,
          lines: { create: lines },
        },
        include: { lines: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        attempt += 1;
        continue;
      }
      throw err;
    }
  }
  throw new ValidationError("Could not allocate a unique bill number — please try again.");
}

export async function deleteBill(billId: string) {
  return prisma.bill.delete({ where: { id: billId } });
}
