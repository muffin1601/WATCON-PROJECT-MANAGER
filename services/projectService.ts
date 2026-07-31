import { prisma } from "../lib/prisma";
import type { PaymentInput, PoItemInput, ProjectInput, ProjectUpdateInput } from "../modules/projects/schema";

// Central place for Project-related writes — route handlers stay thin and
// call into here, per "no business logic inside React components/handlers".

export async function createProject(input: ProjectInput) {
  return prisma.project.create({
    data: {
      name: input.name,
      client: input.client,
      site: input.site || null,
      type: input.type,
      status: input.status,
      approvalMode: input.approvalMode,
      approvalBasisNote: input.approvalBasisNote || null,
      poNumber: input.poNumber || null,
      poDate: input.poDate ? new Date(input.poDate) : null,
      termsGst: input.termsGst,
      termsTransport: input.termsTransport,
      paymentTerms: input.paymentTerms || null,
      items: {
        create: input.items.map((it, i) => ({
          description: it.description,
          unit: it.unit,
          qty: it.qty,
          rate: it.rate,
          sortOrder: i,
        })),
      },
    },
  });
}

export async function updateProject(id: string, input: ProjectUpdateInput) {
  return prisma.project.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.client !== undefined && { client: input.client }),
      ...(input.site !== undefined && { site: input.site || null }),
      ...(input.type !== undefined && { type: input.type }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.approvalMode !== undefined && { approvalMode: input.approvalMode }),
      ...(input.approvalBasisNote !== undefined && { approvalBasisNote: input.approvalBasisNote || null }),
      ...(input.poNumber !== undefined && { poNumber: input.poNumber || null }),
      ...(input.poDate !== undefined && { poDate: input.poDate ? new Date(input.poDate) : null }),
      ...(input.termsGst !== undefined && { termsGst: input.termsGst }),
      ...(input.termsTransport !== undefined && { termsTransport: input.termsTransport }),
      ...(input.paymentTerms !== undefined && { paymentTerms: input.paymentTerms || null }),
    },
  });
}

export async function deleteProject(id: string) {
  return prisma.project.delete({ where: { id } });
}

export async function addProjectItem(projectId: string, input: PoItemInput, sortOrder: number) {
  return prisma.poItem.create({
    data: { projectId, description: input.description, unit: input.unit, qty: input.qty, rate: input.rate, sortOrder },
  });
}

export async function updateProjectItem(itemId: string, input: Partial<PoItemInput>) {
  return prisma.poItem.update({
    where: { id: itemId },
    data: {
      ...(input.description !== undefined && { description: input.description }),
      ...(input.unit !== undefined && { unit: input.unit }),
      ...(input.qty !== undefined && { qty: input.qty }),
      ...(input.rate !== undefined && { rate: input.rate }),
    },
  });
}

export async function deleteProjectItem(itemId: string) {
  return prisma.poItem.delete({ where: { id: itemId } });
}

// Atomically replaces every Sales Order item on a project — used by the OCR
// review "apply" flow. Previously this was N sequential client-side
// DELETE/POST calls; if one failed partway through, the Sales Order could
// be left empty or half-populated. A single transaction makes it all-or-nothing.
export async function replaceProjectItems(projectId: string, items: PoItemInput[]) {
  return prisma.$transaction(async (tx) => {
    // deleteMany() against a non-existent projectId silently deletes zero
    // rows rather than erroring, and createMany() is skipped entirely when
    // items is empty — without this check, calling replace on a project
    // that doesn't exist with an empty items array would return a false
    // "200 success" instead of 404.
    await tx.project.findUniqueOrThrow({ where: { id: projectId } });
    await tx.poItem.deleteMany({ where: { projectId } });
    if (items.length === 0) return [];
    await tx.poItem.createMany({
      data: items.map((it, i) => ({
        projectId,
        description: it.description,
        unit: it.unit,
        qty: it.qty,
        rate: it.rate,
        sortOrder: i,
      })),
    });
    return tx.poItem.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } });
  });
}

export async function recordPayment(projectId: string, input: PaymentInput) {
  return prisma.payment.create({
    data: {
      projectId,
      date: new Date(input.date),
      amount: input.amount,
      mode: input.mode,
      reference: input.reference || null,
    },
  });
}

export async function deletePayment(paymentId: string) {
  return prisma.payment.delete({ where: { id: paymentId } });
}
