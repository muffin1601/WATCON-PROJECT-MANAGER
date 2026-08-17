import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { toNum } from "../lib/decimal";
import { normName } from "../lib/normalize";
import { toFinProject } from "../modules/projects/data";
import { contractValue, siteAccountFigures } from "../services/financials";
import type { CustomerInput, CustomerListQuery, CustomerUpdateInput } from "../modules/customers/schema";

// Customers & References module.
//
// A customer's financial position is DERIVED, never stored: it is the sum of
// the site-account figures of their projects, computed with exactly the same
// services/financials.ts functions the project screens use. Storing running
// totals here would create a second source of truth that silently drifts every
// time a challan or payment is edited.

export class CustomerValidationError extends Error {}
export class CustomerConflictError extends Error {}

// The relations siteAccountFigures() needs, and nothing more.
const projectFinancialsInclude = {
  items: { select: { id: true, description: true, unit: true, qty: true, rate: true } },
  challans: {
    select: {
      id: true,
      date: true,
      manualValue: true,
      items: { select: { itemId: true, qty: true, extraQty: true } },
      extraItems: { select: { description: true, unit: true, qty: true, rate: true } },
    },
  },
  transports: { select: { date: true, amount: true } },
  discounts: { select: { amount: true } },
  amendments: { select: { valueChange: true, applied: true } },
  bills: { select: { netPayable: true } },
  payments: { select: { amount: true } },
} as const;

type ProjectWithFinancials = Prisma.ProjectGetPayload<{ include: typeof projectFinancialsInclude }>;

export interface CustomerFigures {
  projectCount: number;
  quotationCount: number;
  openQuotationCount: number;
  quotedValue: number;
  contract: number;
  sent: number;
  billed: number;
  received: number;
  due: number;
}

function figuresFor(projects: ProjectWithFinancials[], gstRatePct: number): Omit<CustomerFigures, "quotationCount" | "openQuotationCount" | "quotedValue"> {
  let contract = 0;
  let sent = 0;
  let billed = 0;
  let received = 0;
  let due = 0;
  for (const p of projects) {
    const fin = toFinProject(p);
    const f = siteAccountFigures(
      fin,
      p.bills.map((b) => ({ netPayable: toNum(b.netPayable) })),
      p.payments.map((x) => ({ amount: toNum(x.amount) })),
      gstRatePct
    );
    contract += contractValue(fin, gstRatePct);
    sent += f.basicDispatched;
    billed += f.billed;
    received += f.received;
    due += f.balance;
  }
  return { projectCount: projects.length, contract, sent, billed, received, due };
}

export interface CustomerListRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  refBy: string | null;
  salesPerson: string | null;
  archivedAt: string | null;
  figures: CustomerFigures;
}

export interface CustomerListResult {
  rows: CustomerListRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

// Server-side search + pagination. Only the requested page's customers have
// their (relation-heavy) financials loaded, so the query cost does not grow
// with the size of the customer table.
export async function listCustomers(query: CustomerListQuery, gstRatePct: number): Promise<CustomerListResult> {
  const where: Prisma.CustomerWhereInput = {
    ...(query.includeArchived ? {} : { archivedAt: null }),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: "insensitive" } },
            { phone: { contains: query.q, mode: "insensitive" } },
            { email: { contains: query.q, mode: "insensitive" } },
            { refBy: { contains: query.q, mode: "insensitive" } },
            { salesPerson: { contains: query.q, mode: "insensitive" } },
            { gstin: { contains: query.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const total = await prisma.customer.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, pageCount);

  // "due"/"contract" are derived values that SQL cannot ORDER BY, so those two
  // sorts are applied after the page's figures are computed. Name/recent sort
  // in the database, which is what large tables will realistically use.
  const dbSorted = query.sort === "recent" ? { createdAt: "desc" as const } : { name: "asc" as const };

  const customers = await prisma.customer.findMany({
    where,
    orderBy: dbSorted,
    skip: (page - 1) * query.pageSize,
    take: query.pageSize,
    include: {
      projects: { include: projectFinancialsInclude },
      quotations: { select: { status: true, grandTotal: true } },
    },
  });

  const rows: CustomerListRow[] = customers.map((c) => {
    const base = figuresFor(c.projects, gstRatePct);
    const quotedValue = c.quotations.reduce((t, q) => t + toNum(q.grandTotal), 0);
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      refBy: c.refBy,
      salesPerson: c.salesPerson,
      archivedAt: c.archivedAt ? c.archivedAt.toISOString() : null,
      figures: {
        ...base,
        quotationCount: c.quotations.length,
        openQuotationCount: c.quotations.filter((q) => q.status === "DRAFT" || q.status === "SENT").length,
        quotedValue,
      },
    };
  });

  if (query.sort === "due") rows.sort((a, b) => b.figures.due - a.figures.due);
  if (query.sort === "contract") rows.sort((a, b) => b.figures.contract - a.figures.contract);

  return { rows, total, page, pageSize: query.pageSize, pageCount };
}

export interface CustomerDetail {
  id: string;
  name: string;
  billing: string | null;
  delivery: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  refBy: string | null;
  salesPerson: string | null;
  notes: string | null;
  archivedAt: string | null;
  figures: CustomerFigures;
  projects: {
    id: string;
    name: string;
    site: string | null;
    status: string;
    contract: number;
    sent: number;
    received: number;
    balance: number;
  }[];
  quotations: {
    id: string;
    ref: string;
    date: string;
    title: string;
    grandTotal: number;
    status: string;
  }[];
}

export async function getCustomerDetail(id: string, gstRatePct: number): Promise<CustomerDetail | null> {
  const c = await prisma.customer.findUnique({
    where: { id },
    include: {
      projects: { include: projectFinancialsInclude, orderBy: { createdAt: "desc" } },
      quotations: { orderBy: { date: "desc" } },
    },
  });
  if (!c) return null;

  const base = figuresFor(c.projects, gstRatePct);
  const quotedValue = c.quotations.reduce((t, q) => t + toNum(q.grandTotal), 0);

  return {
    id: c.id,
    name: c.name,
    billing: c.billing,
    delivery: c.delivery,
    phone: c.phone,
    email: c.email,
    gstin: c.gstin,
    refBy: c.refBy,
    salesPerson: c.salesPerson,
    notes: c.notes,
    archivedAt: c.archivedAt ? c.archivedAt.toISOString() : null,
    figures: {
      ...base,
      quotationCount: c.quotations.length,
      openQuotationCount: c.quotations.filter((q) => q.status === "DRAFT" || q.status === "SENT").length,
      quotedValue,
    },
    projects: c.projects.map((p) => {
      const fin = toFinProject(p);
      const f = siteAccountFigures(
        fin,
        p.bills.map((b) => ({ netPayable: toNum(b.netPayable) })),
        p.payments.map((x) => ({ amount: toNum(x.amount) })),
        gstRatePct
      );
      return {
        id: p.id,
        name: p.name,
        site: p.site,
        status: p.status,
        contract: contractValue(fin, gstRatePct),
        sent: f.basicDispatched,
        received: f.received,
        balance: f.balance,
      };
    }),
    quotations: c.quotations.map((q) => ({
      id: q.id,
      ref: q.ref,
      date: q.date.toISOString().slice(0, 10),
      title: q.title,
      grandTotal: toNum(q.grandTotal),
      status: q.status,
    })),
  };
}

function toData(input: CustomerInput | CustomerUpdateInput) {
  const blankToNull = (v: string | undefined) => (v === undefined ? undefined : v.trim() === "" ? null : v.trim());
  return {
    ...(input.name !== undefined ? { name: input.name.trim(), normName: normName(input.name) } : {}),
    billing: blankToNull(input.billing),
    delivery: blankToNull(input.delivery),
    phone: blankToNull(input.phone),
    email: blankToNull(input.email),
    gstin: blankToNull(input.gstin),
    refBy: blankToNull(input.refBy),
    salesPerson: blankToNull(input.salesPerson),
    notes: blankToNull(input.notes),
  };
}

export async function createCustomer(input: CustomerInput) {
  const key = normName(input.name);
  if (!key) throw new CustomerValidationError("Customer name is required");
  const existing = await prisma.customer.findUnique({ where: { normName: key } });
  if (existing) {
    throw new CustomerConflictError(
      existing.archivedAt
        ? `"${existing.name}" already exists but is archived — restore it instead of creating a duplicate.`
        : `A customer named "${existing.name}" already exists.`
    );
  }
  return prisma.customer.create({ data: { ...toData(input), name: input.name.trim(), normName: key } });
}

export async function updateCustomer(id: string, input: CustomerUpdateInput) {
  if (input.name !== undefined) {
    const key = normName(input.name);
    if (!key) throw new CustomerValidationError("Customer name is required");
    const clash = await prisma.customer.findUnique({ where: { normName: key } });
    if (clash && clash.id !== id) throw new CustomerConflictError(`A customer named "${clash.name}" already exists.`);
  }

  // Renaming a customer must also refresh the denormalized `client` string on
  // their projects, otherwise the dashboard keeps showing the old name.
  return prisma.$transaction(async (tx) => {
    const updated = await tx.customer.update({ where: { id }, data: toData(input) });
    if (input.name !== undefined) {
      await tx.project.updateMany({ where: { customerId: id }, data: { client: updated.name } });
      await tx.quotation.updateMany({ where: { customerId: id }, data: { client: updated.name } });
    }
    return updated;
  });
}

// Customers are archived, not deleted, whenever they carry history — deleting
// would SetNull the link on real projects/quotations and lose the association.
// A customer with no history at all is safe to remove outright.
export async function archiveCustomer(id: string) {
  return prisma.customer.update({ where: { id }, data: { archivedAt: new Date() } });
}

export async function restoreCustomer(id: string) {
  return prisma.customer.update({ where: { id }, data: { archivedAt: null } });
}

export async function deleteCustomerIfUnused(id: string) {
  const [projects, quotations] = await Promise.all([
    prisma.project.count({ where: { customerId: id } }),
    prisma.quotation.count({ where: { customerId: id } }),
  ]);
  if (projects > 0 || quotations > 0) {
    throw new CustomerValidationError(
      `This customer has ${projects} project(s) and ${quotations} quotation(s). Archive them instead so the history stays intact.`
    );
  }
  return prisma.customer.delete({ where: { id } });
}

// Used by the project/quotation forms: find an existing customer by name or
// create one, so a typed-in client name never silently loses its link.
export async function ensureCustomer(name: string, tx: Prisma.TransactionClient = prisma) {
  const key = normName(name);
  if (!key) return null;
  const existing = await tx.customer.findUnique({ where: { normName: key } });
  if (existing) return existing;
  return tx.customer.create({ data: { name: name.trim(), normName: key } });
}

export interface ReferenceRow {
  name: string;
  customerCount: number;
  projectCount: number;
  quotationCount: number;
  openQuotationCount: number;
  quotedValue: number;
  contract: number;
  received: number;
  due: number;
}

// "Who brings the business" roll-up. A project counts against a reference if it
// names one directly, or (when it doesn't) if its customer was referred by one —
// the same precedence the business uses when attributing a lead.
export async function listReferences(gstRatePct: number): Promise<ReferenceRow[]> {
  const [projects, quotations, customers] = await Promise.all([
    prisma.project.findMany({ include: { ...projectFinancialsInclude, customer: { select: { id: true, refBy: true } } } }),
    prisma.quotation.findMany({ select: { status: true, grandTotal: true, refBy: true, customerId: true } }),
    prisma.customer.findMany({ select: { id: true, refBy: true } }),
  ]);

  const customerRef = new Map(customers.map((c) => [c.id, (c.refBy || "").trim()]));
  const refOf = (direct: string | null | undefined, customerId: string | null | undefined) => {
    const d = (direct || "").trim();
    if (d) return d;
    return customerId ? customerRef.get(customerId) || "" : "";
  };

  const acc = new Map<string, ReferenceRow & { customerIds: Set<string> }>();
  const bucket = (name: string) => {
    let row = acc.get(name);
    if (!row) {
      row = {
        name,
        customerCount: 0,
        projectCount: 0,
        quotationCount: 0,
        openQuotationCount: 0,
        quotedValue: 0,
        contract: 0,
        received: 0,
        due: 0,
        customerIds: new Set<string>(),
      };
      acc.set(name, row);
    }
    return row;
  };

  for (const c of customers) {
    const name = (c.refBy || "").trim();
    if (name) bucket(name).customerIds.add(c.id);
  }

  for (const p of projects) {
    const name = refOf(p.refBy, p.customerId);
    if (!name) continue;
    const row = bucket(name);
    const fin = toFinProject(p);
    const f = siteAccountFigures(
      fin,
      p.bills.map((b) => ({ netPayable: toNum(b.netPayable) })),
      p.payments.map((x) => ({ amount: toNum(x.amount) })),
      gstRatePct
    );
    row.projectCount += 1;
    row.contract += contractValue(fin, gstRatePct);
    row.received += f.received;
    row.due += f.balance;
    if (p.customerId) row.customerIds.add(p.customerId);
  }

  for (const q of quotations) {
    const name = refOf(q.refBy, q.customerId);
    if (!name) continue;
    const row = bucket(name);
    row.quotationCount += 1;
    if (q.status === "DRAFT" || q.status === "SENT") row.openQuotationCount += 1;
    row.quotedValue += toNum(q.grandTotal);
    if (q.customerId) row.customerIds.add(q.customerId);
  }

  return [...acc.values()]
    .map(({ customerIds, ...row }) => ({ ...row, customerCount: customerIds.size }))
    .sort((a, b) => b.contract - a.contract || a.name.localeCompare(b.name));
}

export async function getReferenceDetail(name: string, gstRatePct: number) {
  const rows = await listReferences(gstRatePct);
  const summary = rows.find((r) => r.name.toLowerCase() === name.trim().toLowerCase());
  if (!summary) return null;

  const key = name.trim().toLowerCase();
  const customers = await prisma.customer.findMany({
    where: { refBy: { equals: name.trim(), mode: "insensitive" } },
    select: { id: true, name: true, phone: true, salesPerson: true },
    orderBy: { name: "asc" },
  });
  const referredIds = new Set(customers.map((c) => c.id));

  const [projects, quotations] = await Promise.all([
    prisma.project.findMany({
      include: { ...projectFinancialsInclude, customer: { select: { id: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.quotation.findMany({ orderBy: { date: "desc" } }),
  ]);

  const belongs = (direct: string | null | undefined, customerId: string | null | undefined) => {
    const d = (direct || "").trim().toLowerCase();
    if (d) return d === key;
    return !!customerId && referredIds.has(customerId);
  };

  return {
    name: summary.name,
    summary,
    customers,
    projects: projects
      .filter((p) => belongs(p.refBy, p.customerId))
      .map((p) => {
        const fin = toFinProject(p);
        const f = siteAccountFigures(
          fin,
          p.bills.map((b) => ({ netPayable: toNum(b.netPayable) })),
          p.payments.map((x) => ({ amount: toNum(x.amount) })),
          gstRatePct
        );
        return {
          id: p.id,
          name: p.name,
          client: p.client,
          site: p.site,
          status: p.status,
          contract: contractValue(fin, gstRatePct),
          sent: f.basicDispatched,
          received: f.received,
          balance: f.balance,
        };
      }),
    quotations: quotations
      .filter((q) => belongs(q.refBy, q.customerId))
      .map((q) => ({
        id: q.id,
        ref: q.ref,
        date: q.date.toISOString().slice(0, 10),
        client: q.client,
        title: q.title,
        grandTotal: toNum(q.grandTotal),
        status: q.status,
      })),
  };
}

// Lightweight list for pickers (project form, quotation form).
export async function listCustomerOptions(q: string) {
  return prisma.customer.findMany({
    where: {
      archivedAt: null,
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q, mode: "insensitive" } }] } : {}),
    },
    select: { id: true, name: true, phone: true, billing: true, delivery: true, refBy: true, salesPerson: true, gstin: true },
    orderBy: { name: "asc" },
    take: 50,
  });
}
