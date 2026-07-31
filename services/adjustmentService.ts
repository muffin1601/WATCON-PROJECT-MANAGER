import { prisma } from "../lib/prisma";
import type { AmendmentInput, DiscountInput } from "../modules/adjustments/schema";

export async function addDiscount(projectId: string, input: DiscountInput) {
  return prisma.discount.create({
    data: { projectId, date: new Date(input.date), amount: input.amount, reason: input.reason || null },
  });
}

export async function deleteDiscount(discountId: string) {
  return prisma.discount.delete({ where: { id: discountId } });
}

export async function addAmendment(projectId: string, input: AmendmentInput) {
  return prisma.amendment.create({
    data: { projectId, date: new Date(input.date), description: input.description, valueChange: input.valueChange },
  });
}

export async function deleteAmendment(amendmentId: string) {
  return prisma.amendment.delete({ where: { id: amendmentId } });
}
