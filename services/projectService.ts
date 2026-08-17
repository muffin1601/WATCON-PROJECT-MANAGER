import { prisma } from "../lib/prisma";
import { toNum } from "../lib/decimal";
import { ensureCustomer } from "./customerService";
import type {
  AmendSalesOrderInput,
  PaymentInput,
  PoItemInput,
  ProjectInput,
  ProjectOrderInput,
  ProjectUpdateInput,
  SplitItemInput,
} from "../modules/projects/schema";

export class ProjectValidationError extends Error {}

// Central place for Project-related writes — route handlers stay thin and
// call into here, per "no business logic inside React components/handlers".

export async function createProject(input: ProjectInput) {
  return prisma.$transaction(async (tx) => {
    // Every project ends up attached to a real Customer row, so it appears in
    // that customer's history and in the References roll-up. A typed-in client
    // name creates (or matches) the customer rather than being left dangling.
    let customerId = input.customerId ?? null;
    if (customerId) {
      const exists = await tx.customer.findUnique({ where: { id: customerId } });
      if (!exists) throw new ProjectValidationError("The selected customer no longer exists.");
    } else {
      customerId = (await ensureCustomer(input.client, tx))?.id ?? null;
    }

    return tx.project.create({
      data: {
        name: input.name,
        client: input.client,
        customerId,
        refBy: input.refBy || null,
        salesPerson: input.salesPerson || null,
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
            make: it.make || "",
            unit: it.unit,
            qty: it.qty,
            rate: it.rate,
            sortOrder: i,
          })),
        },
      },
    });
  });
}

export async function updateProject(id: string, input: ProjectUpdateInput) {
  return prisma.project.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.client !== undefined && { client: input.client }),
      ...(input.customerId !== undefined && { customerId: input.customerId }),
      ...(input.refBy !== undefined && { refBy: input.refBy || null }),
      ...(input.salesPerson !== undefined && { salesPerson: input.salesPerson || null }),
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

// ---------- Delete an entire project ----------
// (The former bare `deleteProject()` is gone: it deleted the row without
// authorisation and without cleaning up the project's files in storage.
// deleteProjectCompletely() below is the only deletion path.)

export interface ProjectDeletionSummary {
  projectName: string;
  items: number;
  orders: number;
  challans: number;
  transports: number;
  bills: number;
  payments: number;
  discounts: number;
  amendments: number;
  purchaseOrders: number;
  documents: number;
  extractionJobs: number;
  /** Storage objects removed, and any that could not be removed. */
  filesRemoved: number;
  filesFailed: number;
}

/**
 * Every Document that belongs to this project, however it is attached.
 *
 * Documents hang off a project directly *or* off one of its challans,
 * payments, amendments, transports, purchase orders or additional orders. All
 * of those rows cascade away with the project, so their files must be
 * collected before the delete — afterwards there is no row left to find the
 * storage path from, and the object would leak forever.
 */
function projectDocumentFilter(projectId: string) {
  return {
    OR: [
      { projectId },
      { challan: { projectId } },
      { payment: { projectId } },
      { amendment: { projectId } },
      { transport: { projectId } },
      { purchaseOrder: { projectId } },
      { projectOrder: { projectId } },
    ],
  };
}

/**
 * Deletes a project and everything that belongs exclusively to it.
 *
 * What is removed: the project row, its Sales Order items and additional
 * orders, challans (with their items, extra items and links), transports,
 * running bills and bill lines, payments, discounts, amendments, vendor
 * purchase orders and their lines, every uploaded document (all versions,
 * their extracted page text and OCR results), extraction jobs, and the
 * project's activity log.
 *
 * What is deliberately NOT touched: other projects, and the shared master
 * data — vendors, the Items & Stocks master and its stock entries, company
 * settings, backup history. None of those are project-owned; a vendor exists
 * independently of any one order, and deleting stock history because a
 * project was removed would corrupt every other project's stock position.
 *
 * Ordering is deliberate. The database delete runs first and is a single
 * statement, so the schema's ON DELETE CASCADE rules make it atomic — it
 * cannot half-succeed and leave orphaned challans or bills behind. Storage
 * cleanup follows. If a file removal fails, the database is already
 * consistent and the caller is told how many objects were left behind, which
 * is a recoverable leak; doing it the other way round would risk deleting
 * files belonging to a project that then survives.
 */
export async function deleteProjectCompletely(
  projectId: string,
  removeFiles: (files: { bucket: string; storagePath: string }[]) => Promise<{ removed: number; failed: number }>
): Promise<ProjectDeletionSummary> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      name: true,
      _count: {
        select: {
          items: true,
          orders: true,
          challans: true,
          transports: true,
          bills: true,
          payments: true,
          discounts: true,
          amendments: true,
          purchaseOrders: true,
          extractionJobs: true,
        },
      },
    },
  });
  if (!project) throw new ProjectNotFoundError("Project not found");

  const documents = await prisma.document.findMany({
    where: projectDocumentFilter(projectId),
    select: { bucket: true, storagePath: true },
  });

  await prisma.project.delete({ where: { id: projectId } });

  const { removed, failed } = documents.length ? await removeFiles(documents) : { removed: 0, failed: 0 };

  return {
    projectName: project.name,
    items: project._count.items,
    orders: project._count.orders,
    challans: project._count.challans,
    transports: project._count.transports,
    bills: project._count.bills,
    payments: project._count.payments,
    discounts: project._count.discounts,
    amendments: project._count.amendments,
    purchaseOrders: project._count.purchaseOrders,
    documents: documents.length,
    extractionJobs: project._count.extractionJobs,
    filesRemoved: removed,
    filesFailed: failed,
  };
}

export class ProjectNotFoundError extends Error {}

export async function addProjectItem(projectId: string, input: PoItemInput, sortOrder: number) {
  return prisma.poItem.create({
    data: {
      projectId,
      orderId: input.orderId || null,
      description: input.description,
      make: input.make || "",
      unit: input.unit,
      qty: input.qty,
      rate: input.rate,
      sortOrder,
    },
  });
}

export async function updateProjectItem(itemId: string, input: Partial<PoItemInput>) {
  return prisma.poItem.update({
    where: { id: itemId },
    data: {
      ...(input.description !== undefined && { description: input.description }),
      ...(input.make !== undefined && { make: input.make || "" }),
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
        make: it.make || "",
        unit: it.unit,
        qty: it.qty,
        rate: it.rate,
        sortOrder: i,
      })),
    });
    return tx.poItem.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } });
  });
}

// ---------- Split item (prototype's splitItemModal) ----------
// Bifurcates one Sales Order line into 2+ sub-items whose value must total
// EXACTLY the original amount (±₹1 rounding). The FIRST sub-item keeps the
// original row id, so quantities already dispatched via challans carry
// against it — exactly the prototype's behaviour.
export async function splitProjectItem(projectId: string, itemId: string, input: SplitItemInput) {
  return prisma.$transaction(async (tx) => {
    const it = await tx.poItem.findFirst({ where: { id: itemId, projectId } });
    if (!it) throw new ProjectValidationError("Sales order item not found");
    const origAmt = toNum(it.qty) * toNum(it.rate);
    const subs = input.subs.filter((w) => w.description.trim() && w.qty > 0);
    if (subs.length < 2) throw new ProjectValidationError("Enter at least 2 sub-items with description and quantity");
    const subTotal = subs.reduce((t, w) => t + w.qty * w.rate, 0);
    const d = subTotal - origAmt;
    if (Math.abs(d) > 1) {
      throw new ProjectValidationError(
        `The sub-items must total exactly the original item value. Currently ${d > 0 ? "over" : "short"} by ₹ ${Math.abs(d).toFixed(2)}. A split bifurcates the item — it cannot add or remove value.`
      );
    }
    // Splitting an already-split item keeps the original root description.
    const root = it.splitFrom || it.description;
    const [first, ...rest] = subs;
    await tx.poItem.update({
      where: { id: it.id },
      data: {
        description: first!.description.trim(),
        unit: first!.unit.trim() || "Nos",
        qty: first!.qty,
        rate: first!.rate,
        splitFrom: root,
      },
    });
    await tx.poItem.createMany({
      data: rest.map((w, i) => ({
        projectId,
        orderId: it.orderId,
        splitFrom: root,
        make: it.make,
        description: w.description.trim(),
        unit: w.unit.trim() || "Nos",
        qty: w.qty,
        rate: w.rate,
        sortOrder: it.sortOrder, // keeps the group together; ties keep insert order
      })),
    });
    return tx.poItem.findMany({ where: { projectId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  });
}

// ---------- Amend sales order (prototype's amendSOModal) ----------
// Replaces the working set of items and records the value difference as an
// `applied` amendment (already reflected in item values → excluded from
// amendTotal, so contract value moves by exactly the item change once).
export async function amendSalesOrder(projectId: string, input: AmendSalesOrderInput) {
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: projectId }, include: { items: true } });
    if (!project) throw new ProjectValidationError("Project not found");
    const oldBase = project.items.reduce((t, i) => t + toNum(i.qty) * toNum(i.rate), 0);
    const newBase = input.items.reduce((t, i) => t + i.qty * i.rate, 0);
    const diff = newBase - oldBase;

    const keepIds = new Set(input.items.map((i) => i.id).filter(Boolean) as string[]);
    // Remove items dropped in the amendment (challan lines cascade away).
    await tx.poItem.deleteMany({ where: { projectId, id: { notIn: [...keepIds] } } });
    for (let i = 0; i < input.items.length; i++) {
      const w = input.items[i]!;
      if (w.id && project.items.some((x) => x.id === w.id)) {
        await tx.poItem.update({
          where: { id: w.id },
          data: { description: w.description, make: w.make || "", unit: w.unit, qty: w.qty, rate: w.rate, sortOrder: i },
        });
      } else {
        await tx.poItem.create({
          data: {
            projectId,
            orderId: w.orderId || null,
            description: w.description,
            make: w.make || "",
            unit: w.unit,
            qty: w.qty,
            rate: w.rate,
            sortOrder: i,
          },
        });
      }
    }
    return tx.amendment.create({
      data: {
        projectId,
        date: new Date(input.date),
        description: "Sales order amendment: " + input.note,
        valueChange: diff,
        applied: true,
      },
    });
  });
}

// ---------- Additional orders (prototype's addOrderModal) ----------
export async function addProjectOrder(projectId: string, input: ProjectOrderInput) {
  return prisma.projectOrder.create({
    data: {
      projectId,
      ref: input.ref,
      date: input.date ? new Date(input.date) : null,
      items: {
        create: input.items.map((it, i) => ({
          projectId,
          description: it.description,
          make: it.make || "",
          unit: it.unit,
          qty: it.qty,
          rate: it.rate,
          sortOrder: i,
        })),
      },
    },
    include: { items: true },
  });
}

// Deletes an order and all its items (challan links cascade away) —
// prototype's data-odel handler.
export async function deleteProjectOrder(orderId: string) {
  return prisma.projectOrder.delete({ where: { id: orderId } });
}

// Deletes the ENTIRE sales order: every item and every additional order.
// Bills already generated remain as saved (prototype's soDelete handler).
export async function deleteSalesOrder(projectId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.project.findUniqueOrThrow({ where: { id: projectId } });
    await tx.poItem.deleteMany({ where: { projectId } });
    await tx.projectOrder.deleteMany({ where: { projectId } });
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
