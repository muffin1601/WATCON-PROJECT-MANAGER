import { prisma } from "../lib/prisma";
import { toNum } from "../lib/decimal";
import { computeDispatchBalances, type FinProject } from "./financials";
import type {
  AttachChallanInput,
  ChallanExtraItemInput,
  ChallanItemInput,
  IssueChallanInput,
} from "../modules/challans/schema";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const challanFetchInclude = {
  items: true,
  challans: { include: { items: true, extraItems: true } },
} as const;

async function loadFinShape(projectId: string): Promise<Pick<FinProject, "items" | "challans">> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, include: challanFetchInclude });
  if (!project) throw new ValidationError("Project not found");
  return {
    items: project.items.map((i) => ({ id: i.id, description: i.description, unit: i.unit, qty: toNum(i.qty), rate: toNum(i.rate) })),
    challans: project.challans.map((c) => ({
      id: c.id,
      date: c.date.toISOString().slice(0, 10),
      manualValue: c.manualValue ? toNum(c.manualValue) : null,
      items: c.items.map((ci) => ({ itemId: ci.itemId, qty: toNum(ci.qty), extraQty: toNum(ci.extraQty) })),
      extraItems: c.extraItems.map((x) => ({ description: x.description, unit: x.unit, qty: toNum(x.qty), rate: toNum(x.rate) })),
    })),
  };
}

export async function getDispatchBalances(projectId: string, excludeChallanId?: string) {
  const fin = await loadFinShape(projectId);
  return computeDispatchBalances(fin, excludeChallanId);
}

// Server-side enforcement of the two hard rules from the prototype's
// challanModal() save handler — never trust the client for these:
//   1. "dispatch now" qty cannot exceed the item's remaining balance qty.
//   2. "extra qty" (beyond BOQ) silently clamps to 0 unless the item's full
//      SO qty has already been dispatched (this challan's own qty included).
function reconcileItems(
  items: ChallanItemInput[],
  balances: ReturnType<typeof computeDispatchBalances>
): { itemId: string; qty: number; extraQty: number }[] {
  const byId = new Map(balances.map((b) => [b.itemId, b]));
  const out: { itemId: string; qty: number; extraQty: number }[] = [];
  for (const line of items) {
    const bal = byId.get(line.itemId);
    if (!bal) throw new ValidationError("Sales order item not found on this project");
    if (line.qty < 0 || line.extraQty < 0) throw new ValidationError("Quantities cannot be negative");
    if (line.qty > bal.balance + 1e-9) {
      throw new ValidationError(
        `Dispatch now (${line.qty}) exceeds balance (${bal.balance}) for one of the items`
      );
    }
    const fullyDispatchedWithThis = bal.issuedOthers + line.qty >= bal.soQty;
    const extraQty = fullyDispatchedWithThis ? line.extraQty : 0;
    if (line.qty > 0 || extraQty > 0) out.push({ itemId: line.itemId, qty: line.qty, extraQty });
  }
  return out;
}

function reconcileExtraItems(extraItems: ChallanExtraItemInput[]) {
  return extraItems
    .filter((x) => x.qty > 0 && x.description.trim())
    .map((x) => ({ description: x.description.trim(), unit: x.unit || "Nos", qty: x.qty, rate: x.rate || 0 }));
}

export async function createIssuedChallan(projectId: string, input: IssueChallanInput) {
  const balances = await getDispatchBalances(projectId);
  const items = reconcileItems(input.items, balances);
  const extraItems = reconcileExtraItems(input.extraItems);
  if (!items.length && !extraItems.length) {
    throw new ValidationError("Enter a dispatch quantity for at least one item");
  }

  return prisma.$transaction(async (tx) => {
    const settings = await tx.setting.findUnique({ where: { key: "default" } });
    if (!settings) throw new ValidationError("Settings not configured");
    const no = `${settings.challanPrefix}${String(settings.challanNext).padStart(3, "0")}`;

    const challan = await tx.challan.create({
      data: {
        projectId,
        no,
        date: new Date(input.date),
        source: "ISSUED_HERE",
        vehicle: input.vehicle || null,
        driver: input.driver || null,
        remarks: input.remarks || null,
        items: { create: items },
        extraItems: { create: extraItems },
      },
      include: { items: true, extraItems: true },
    });

    await tx.setting.update({ where: { key: "default" }, data: { challanNext: { increment: 1 } } });
    return challan;
  });
}

export async function updateIssuedChallan(challanId: string, projectId: string, input: IssueChallanInput) {
  const balances = await getDispatchBalances(projectId, challanId);
  const items = reconcileItems(input.items, balances);
  const extraItems = reconcileExtraItems(input.extraItems);
  if (!items.length && !extraItems.length) {
    throw new ValidationError("Enter a dispatch quantity for at least one item");
  }

  return prisma.$transaction(async (tx) => {
    await tx.challanItem.deleteMany({ where: { challanId } });
    await tx.challanExtraItem.deleteMany({ where: { challanId } });
    return tx.challan.update({
      where: { id: challanId },
      data: {
        date: new Date(input.date),
        vehicle: input.vehicle || null,
        driver: input.driver || null,
        remarks: input.remarks || null,
        items: { create: items },
        extraItems: { create: extraItems },
      },
      include: { items: true, extraItems: true },
    });
  });
}

export async function createAttachedChallan(projectId: string, input: AttachChallanInput) {
  const items = input.items.filter((x) => x.qty > 0);
  return prisma.challan.create({
    data: {
      projectId,
      no: input.no,
      date: new Date(input.date),
      source: "ATTACHED_EXTERNAL",
      manualValue: items.length ? null : input.manualValue ?? null,
      items: { create: items },
    },
    include: { items: true, extraItems: true },
  });
}

export async function updateAttachedChallan(challanId: string, input: AttachChallanInput) {
  const items = input.items.filter((x) => x.qty > 0);
  return prisma.$transaction(async (tx) => {
    await tx.challanItem.deleteMany({ where: { challanId } });
    return tx.challan.update({
      where: { id: challanId },
      data: {
        no: input.no,
        date: new Date(input.date),
        manualValue: items.length ? null : input.manualValue ?? null,
        items: { create: items },
      },
      include: { items: true, extraItems: true },
    });
  });
}

export async function deleteChallan(challanId: string) {
  return prisma.challan.delete({ where: { id: challanId } });
}
