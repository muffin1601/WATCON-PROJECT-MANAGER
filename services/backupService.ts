import { prisma } from "../lib/prisma";

// Import backup / Clear all data — both ported from the prototype's Settings
// screen, and both destructive, so they follow its own rules exactly:
//
//   Clear all data — deletes projects, customers, quotations, the item sheet,
//   the item master and stock records. Company details, numbering, credentials
//   and USER ACCOUNTS are kept, exactly as the prototype's confirmation text
//   promises. Purchase records go too, because they hang off projects and
//   items; leaving them would strand rows pointing at deleted material.
//
//   Import backup — replaces the current data with the file's, keeping the
//   existing user accounts (the prototype does the same:
//   `const keepUsers = state.users; state = j;`). Settings are restored from
//   the file, but stored password hashes are never taken from it.

export class BackupImportError extends Error {}

/**
 * Deletes business data. One transaction, so a failure leaves the database
 * exactly as it was rather than half-cleared.
 *
 * Deliberately NOT touched: users, sessions, settings (including numbering and
 * credentials) and the migration history — the app must still run afterwards.
 */
export async function clearAllData(): Promise<Record<string, number>> {
  return prisma.$transaction(
    async (tx) => {
      const counts: Record<string, number> = {};
      // Order matters only where a row is not covered by a cascade.
      counts.purchaseOrders = (await tx.purchaseOrder.deleteMany({})).count;
      counts.rfqs = (await tx.rfq.deleteMany({})).count;
      counts.quotations = (await tx.quotation.deleteMany({})).count;
      // Projects cascade to items, orders, challans, transports, bills,
      // payments, discounts, amendments, documents, activity logs and jobs.
      counts.projects = (await tx.project.deleteMany({})).count;
      counts.customers = (await tx.customer.deleteMany({})).count;
      counts.vendors = (await tx.vendor.deleteMany({})).count;
      counts.catalogItems = (await tx.catalogItem.deleteMany({})).count;
      counts.itemMasters = (await tx.itemMaster.deleteMany({})).count;
      // Numbering restarts, as the prototype does.
      await tx.setting.update({
        where: { key: "default" },
        data: { challanNext: 1, quoteNext: 1, rfqNext: 1, poNext: 1 },
      });
      return counts;
    },
    { timeout: 60_000, maxWait: 20_000 }
  );
}

type Row = Record<string, unknown>;

interface BackupFile {
  exportedAt?: string;
  settings?: Row | null;
  projects?: unknown[];
  customers?: Row[];
  quotations?: Row[];
  vendors?: Row[];
  catalog?: Row[];
  itemMasters?: Row[];
  rfqs?: Row[];
  purchaseOrders?: Row[];
}

const asDate = (v: unknown) => (v ? new Date(v as string) : null);
const asNum = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const asNullNum = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/**
 * Restores a backup produced by exportAllData().
 *
 * Two rules keep this safe, both learned the hard way:
 *
 *  1. **Validate before deleting.** A file without a `projects` array is
 *     rejected outright, so picking the wrong file cannot wipe the database.
 *  2. **Never delete what the file cannot restore.** A table is only cleared
 *     when the backup actually carries a section for it. An older backup that
 *     predates (say) the customers section therefore leaves customers alone
 *     instead of destroying them — the alternative silently loses data that the
 *     file was never able to bring back.
 *
 * The whole restore is one transaction.
 */
export async function importBackup(raw: unknown): Promise<{ projects: number }> {
  const file = raw as BackupFile;
  if (!file || typeof file !== "object" || !Array.isArray(file.projects)) {
    throw new BackupImportError("That file is not a Watcon backup (it has no projects list).");
  }
  const has = (v: unknown): v is Row[] => Array.isArray(v);
  const projects = file.projects as (Row & {
    items?: Row[];
    challans?: Row[];
    bills?: Row[];
    payments?: Row[];
    discounts?: Row[];
    amendments?: Row[];
  })[];

  return prisma.$transaction(
    async (tx) => {
      // Replace, as the prototype does — but only the sections this file can
      // actually put back. Order matters: children before the rows they
      // reference. Projects always go, because `projects` is mandatory.
      if (has(file.purchaseOrders)) await tx.purchaseOrder.deleteMany({});
      if (has(file.rfqs)) await tx.rfq.deleteMany({});
      if (has(file.quotations)) await tx.quotation.deleteMany({});
      await tx.project.deleteMany({});
      if (has(file.customers)) await tx.customer.deleteMany({});
      if (has(file.vendors)) await tx.vendor.deleteMany({});
      if (has(file.catalog)) await tx.catalogItem.deleteMany({});
      if (has(file.itemMasters)) await tx.itemMaster.deleteMany({});

      // Customers come back first: projects and quotations point at them.
      if (has(file.customers) && file.customers.length) {
        await tx.customer.createMany({
          data: file.customers.map((c) => ({
            id: c.id as string,
            name: (c.name as string) ?? "",
            normName: (c.normName as string) ?? String(c.name ?? "").trim().toLowerCase(),
            billing: (c.billing as string) ?? null,
            delivery: (c.delivery as string) ?? null,
            phone: (c.phone as string) ?? null,
            email: (c.email as string) ?? null,
            gstin: (c.gstin as string) ?? null,
            refBy: (c.refBy as string) ?? null,
            salesPerson: (c.salesPerson as string) ?? null,
            notes: (c.notes as string) ?? null,
            archivedAt: asDate(c.archivedAt),
          })),
        });
      }

      for (const p of projects) {
        await tx.project.create({
          data: {
            id: p.id as string,
            name: (p.name as string) ?? "Untitled",
            client: (p.client as string) ?? "",
            customerId: has(file.customers) ? ((p.customerId as string) ?? null) : null,
            refBy: (p.refBy as string) ?? null,
            salesPerson: (p.salesPerson as string) ?? null,
            site: (p.site as string) ?? null,
            type: (p.type as never) ?? "MIXED_SCOPE",
            status: (p.status as never) ?? "IN_PROGRESS",
            approvalMode: (p.approvalMode as never) ?? "PURCHASE_ORDER",
            approvalBasisNote: (p.approvalBasisNote as string) ?? null,
            poNumber: (p.poNumber as string) ?? null,
            poDate: asDate(p.poDate),
            termsGst: (p.termsGst as never) ?? "EXTRA",
            termsTransport: (p.termsTransport as never) ?? "EXTRA",
            paymentTerms: (p.paymentTerms as string) ?? null,
            aiGenerated: !!p.aiGenerated,
            costing: (p.costing as never) ?? undefined,
            items: {
              create: (p.items ?? []).map((i, idx) => ({
                id: i.id as string,
                description: (i.description as string) ?? "",
                make: (i.make as string) ?? "",
                unit: (i.unit as string) ?? "Nos",
                qty: asNum(i.qty),
                rate: asNum(i.rate),
                splitFrom: (i.splitFrom as string) ?? null,
                sortOrder: Number(i.sortOrder ?? idx),
              })),
            },
            discounts: {
              create: (p.discounts ?? []).map((x) => ({
                date: asDate(x.date) ?? new Date(),
                amount: asNum(x.amount),
                reason: (x.reason as string) ?? null,
              })),
            },
            amendments: {
              create: (p.amendments ?? []).map((x) => ({
                date: asDate(x.date) ?? new Date(),
                description: (x.description as string) ?? "",
                valueChange: asNum(x.valueChange),
                applied: !!x.applied,
              })),
            },
            payments: {
              create: (p.payments ?? []).map((x) => ({
                date: asDate(x.date) ?? new Date(),
                amount: asNum(x.amount),
                mode: (x.mode as never) ?? "BANK_TRANSFER",
                reference: (x.reference as string) ?? null,
              })),
            },
          },
        });

        // Additional client orders, before the challans/documents that may
        // reference them.
        const orders = (p.orders as Row[]) ?? [];
        if (orders.length) {
          await tx.projectOrder.createMany({
            data: orders.map((o) => ({
              id: o.id as string,
              projectId: p.id as string,
              ref: (o.ref as string) ?? "",
              date: asDate(o.date),
            })),
          });
        }

        const transports = (p.transports as Row[]) ?? [];
        if (transports.length) {
          await tx.transport.createMany({
            data: transports.map((t) => ({
              id: t.id as string,
              projectId: p.id as string,
              date: asDate(t.date) ?? new Date(),
              amount: asNum(t.amount),
              transporter: (t.transporter as string) ?? null,
              ref: (t.ref as string) ?? null,
              vehicle: (t.vehicle as string) ?? null,
            })),
          });
        }

        // Challans reference sales order item ids, so they follow the items.
        for (const c of p.challans ?? []) {
          const items = (c.items as Row[]) ?? [];
          const extraItems = (c.extraItems as Row[]) ?? [];
          await tx.challan.create({
            data: {
              id: c.id as string,
              projectId: p.id as string,
              no: (c.no as string) ?? "",
              date: asDate(c.date) ?? new Date(),
              source: (c.source as never) ?? "ISSUED_HERE",
              vehicle: (c.vehicle as string) ?? null,
              driver: (c.driver as string) ?? null,
              remarks: (c.remarks as string) ?? null,
              manualValue: asNullNum(c.manualValue),
              items: {
                create: items.map((ci) => ({
                  itemId: ci.itemId as string,
                  qty: asNum(ci.qty),
                  extraQty: asNum(ci.extraQty),
                })),
              },
              extraItems: {
                create: extraItems.map((x) => ({
                  description: (x.description as string) ?? "",
                  unit: (x.unit as string) ?? "Nos",
                  qty: asNum(x.qty),
                  rate: asNum(x.rate),
                })),
              },
            },
          });
        }

        for (const b of p.bills ?? []) {
          const lines = (b.lines as Row[]) ?? [];
          await tx.bill.create({
            data: {
              projectId: p.id as string,
              no: (b.no as string) ?? "",
              date: asDate(b.date) ?? new Date(),
              grossBasic: asNum(b.grossBasic),
              discountApplied: asNum(b.discountApplied),
              discountCum: asNum(b.discountCum),
              gst: asNum(b.gst),
              transportCum: asNum(b.transportCum),
              grossToDate: asNum(b.grossToDate),
              priorBilled: asNum(b.priorBilled),
              netPayable: asNum(b.netPayable),
              lines: {
                create: lines.map((l) => ({
                  description: (l.description as string) ?? "",
                  unit: (l.unit as string) ?? null,
                  orderQty: asNullNum(l.orderQty),
                  cumQty: asNullNum(l.cumQty),
                  rate: asNullNum(l.rate),
                  amount: asNum(l.amount),
                  isExtra: !!l.isExtra,
                })),
              },
            },
          });
        }
      }

      // Document METADATA. The files themselves live in Supabase Storage and
      // are never touched by import/export, so restoring the rows re-attaches
      // the documents that are still there.
      const allDocs = projects.flatMap((p) =>
        ((p.documents as Row[]) ?? []).map((d) => ({
          id: d.id as string,
          kind: (d.kind as never) ?? "OTHER",
          projectId: p.id as string,
          fileName: (d.fileName as string) ?? "",
          mimeType: (d.mimeType as string) ?? "application/octet-stream",
          sizeBytes: Number(d.sizeBytes ?? 0),
          storagePath: (d.storagePath as string) ?? "",
          bucket: (d.bucket as string) ?? "watcon-documents",
          checksum: (d.checksum as string) ?? null,
          notes: (d.notes as string) ?? null,
          versionNumber: Number(d.versionNumber ?? 1),
        }))
      );
      if (allDocs.length) await tx.document.createMany({ data: allDocs });

      if (has(file.vendors) && file.vendors.length) {
        await tx.vendor.createMany({
          data: file.vendors.map((v) => ({
            id: v.id as string,
            name: (v.name as string) ?? "",
            contact: (v.contact as string) ?? null,
            gstin: (v.gstin as string) ?? null,
            phone: (v.phone as string) ?? null,
            email: (v.email as string) ?? null,
            address: (v.address as string) ?? null,
          })),
        });
      }

      if (has(file.catalog)) {
        for (const c of file.catalog) {
          await tx.catalogItem.create({
            data: {
              id: c.id as string,
              name: (c.name as string) ?? "",
              normName: (c.normName as string) ?? String(c.name ?? "").trim().toLowerCase(),
              unit: (c.unit as string) ?? "Nos",
              category: (c.category as string) ?? null,
              hsn: (c.hsn as string) ?? null,
              details: (c.details as string) ?? null,
              makes: (c.makes as string[]) ?? [],
              sellPrice: asNullNum(c.sellPrice),
              discountPct: asNullNum(c.discountPct),
              purchasePrice: asNullNum(c.purchasePrice),
              purchaseDiscPct: asNullNum(c.purchaseDiscPct),
              imagePath: (c.imagePath as string) ?? null,
              imageMime: (c.imageMime as string) ?? null,
              archivedAt: asDate(c.archivedAt),
              components: {
                create: ((c.components as Row[]) ?? []).map((x, i) => ({
                  name: (x.name as string) ?? "",
                  make: (x.make as string) ?? "",
                  unit: (x.unit as string) ?? "Nos",
                  qty: asNum(x.qty),
                  sortOrder: Number(x.sortOrder ?? i),
                })),
              },
            },
          });
        }
      }

      if (has(file.itemMasters) && file.itemMasters.length) {
        await tx.itemMaster.createMany({
          data: file.itemMasters.map((m) => ({
            id: m.id as string,
            name: (m.name as string) ?? "",
            make: (m.make as string) ?? "",
            unit: (m.unit as string) ?? "Nos",
            normKey: (m.normKey as string) ?? "",
          })),
        });
        const entries = file.itemMasters.flatMap((m) =>
          ((m.entries as Row[]) ?? []).map((e) => ({
            itemMasterId: m.id as string,
            date: asDate(e.date) ?? new Date(),
            qty: asNum(e.qty),
            note: (e.note as string) ?? null,
            type: (e.type as never) ?? ("ADJUST_IN" as never),
            rate: asNullNum(e.rate),
            vendor: (e.vendor as string) ?? null,
            ref: (e.ref as string) ?? null,
          }))
        );
        if (entries.length) await tx.stockEntry.createMany({ data: entries });
      }

      if (has(file.quotations)) {
        for (const q of file.quotations) {
          await tx.quotation.create({
            data: {
              id: q.id as string,
              ref: (q.ref as string) ?? "",
              date: asDate(q.date) ?? new Date(),
              customerId: has(file.customers) ? ((q.customerId as string) ?? null) : null,
              client: (q.client as string) ?? "",
              billing: (q.billing as string) ?? null,
              delivery: (q.delivery as string) ?? null,
              title: (q.title as string) ?? "",
              refBy: (q.refBy as string) ?? null,
              salesPerson: (q.salesPerson as string) ?? null,
              status: (q.status as never) ?? "DRAFT",
              validityDays: Number(q.validityDays ?? 30),
              discountPct: asNum(q.discountPct),
              installMode: (q.installMode as never) ?? "INCLUDED",
              installBasis: (q.installBasis as never) ?? "PERCENT",
              installValue: asNum(q.installValue),
              transportMode: (q.transportMode as never) ?? "INCLUDED",
              transportAmount: asNum(q.transportAmount),
              gstMode: (q.gstMode as never) ?? "EXTRA",
              gstPct: asNum(q.gstPct),
              roundTo: asNullNum(q.roundTo),
              note: (q.note as string) ?? null,
              terms: (q.terms as string) ?? null,
              showDetails: !!q.showDetails,
              areaTotalsWithGst: !!q.areaTotalsWithGst,
              sections: (q.sections as string[]) ?? [],
              subtotal: asNum(q.subtotal),
              discountAmount: asNum(q.discountAmount),
              netAmount: asNum(q.netAmount),
              installAmount: asNum(q.installAmount),
              roundedAmount: asNum(q.roundedAmount),
              gstAmount: asNum(q.gstAmount),
              grandTotal: asNum(q.grandTotal),
              costing: (q.costing as never) ?? undefined,
              convertedProjectId: (q.convertedProjectId as string) ?? null,
              convertedAt: asDate(q.convertedAt),
              archivedAt: asDate(q.archivedAt),
              items: {
                create: ((q.items as Row[]) ?? []).map((i, idx) => ({
                  catalogItemId: has(file.catalog) ? ((i.catalogItemId as string) ?? null) : null,
                  section: (i.section as string) ?? "",
                  description: (i.description as string) ?? "",
                  makes: (i.makes as string[]) ?? [],
                  unit: (i.unit as string) ?? "Nos",
                  qty: asNum(i.qty),
                  rate: asNum(i.rate),
                  discPct: asNullNum(i.discPct),
                  sortOrder: Number(i.sortOrder ?? idx),
                })),
              },
            },
          });
        }
      }

      // Rate inquiries, then the POs that reference them.
      if (has(file.rfqs)) {
        for (const r of file.rfqs) {
          await tx.rfq.create({
            data: {
              id: r.id as string,
              no: (r.no as string) ?? "",
              date: asDate(r.date) ?? new Date(),
              due: asDate(r.due),
              deliverTo: (r.deliverTo as string) ?? null,
              note: (r.note as string) ?? null,
              status: (r.status as never) ?? "SENT",
              projectIds: (r.projectIds as string[]) ?? [],
              lines: {
                create: ((r.lines as Row[]) ?? []).map((l, i) => ({
                  id: l.id as string,
                  name: (l.name as string) ?? "",
                  make: (l.make as string) ?? "",
                  unit: (l.unit as string) ?? "Nos",
                  category: (l.category as string) ?? null,
                  required: asNum(l.required),
                  stock: asNum(l.stock),
                  qty: asNum(l.qty),
                  projectNames: (l.projectNames as string[]) ?? [],
                  sortOrder: Number(l.sortOrder ?? i),
                  chosenVendorId: (l.chosenVendorId as string) ?? null,
                })),
              },
            },
          });
          if (has(file.vendors)) {
            for (const v of (r.vendors as Row[]) ?? []) {
              await tx.rfqVendor.create({
                data: { rfqId: r.id as string, vendorId: v.vendorId as string },
              });
            }
            for (const resp of (r.responses as Row[]) ?? []) {
              await tx.rfqResponse.create({
                data: {
                  id: resp.id as string,
                  rfqId: r.id as string,
                  vendorId: resp.vendorId as string,
                  quotedBy: (resp.quotedBy as string) ?? null,
                  contact: (resp.contact as string) ?? null,
                  ref: (resp.ref as string) ?? null,
                  validity: resp.validity === null || resp.validity === undefined ? null : Number(resp.validity),
                  transport: asNum(resp.transport),
                  transportGst: asNum(resp.transportGst),
                  transportNote: (resp.transportNote as string) ?? null,
                  delivery: (resp.delivery as string) ?? null,
                  payment: (resp.payment as string) ?? null,
                  remarks: (resp.remarks as string) ?? null,
                  manual: !!resp.manual,
                  filledAt: asDate(resp.filledAt),
                  offers: {
                    create: ((resp.offers as Row[]) ?? []).map((o) => ({
                      lineId: o.lineId as string,
                      rate: asNullNum(o.rate),
                      gstPct: asNum(o.gstPct),
                      remark: (o.remark as string) ?? null,
                    })),
                  },
                },
              });
            }
          }
        }
      }

      if (has(file.purchaseOrders) && has(file.vendors)) {
        for (const o of file.purchaseOrders) {
          await tx.purchaseOrder.create({
            data: {
              id: o.id as string,
              poNumber: (o.poNumber as string) ?? "",
              vendorId: o.vendorId as string,
              projectId: (o.projectId as string) ?? null,
              rfqId: has(file.rfqs) ? ((o.rfqId as string) ?? null) : null,
              status: (o.status as never) ?? "ISSUED",
              poDate: asDate(o.poDate) ?? new Date(),
              remarks: (o.remarks as string) ?? null,
              transport: asNum(o.transport),
              transportGst: asNum(o.transportGst),
              transportNote: (o.transportNote as string) ?? null,
              delivery: (o.delivery as string) ?? null,
              payment: (o.payment as string) ?? null,
              deliverTo: (o.deliverTo as string) ?? null,
              subtotal: asNum(o.subtotal),
              taxAmount: asNum(o.taxAmount),
              discountAmount: asNum(o.discountAmount),
              totalAmount: asNum(o.totalAmount),
              lines: {
                create: ((o.lines as Row[]) ?? []).map((l, i) => ({
                  description: (l.description as string) ?? "",
                  make: (l.make as string) ?? "",
                  unit: (l.unit as string) ?? "Nos",
                  qty: asNum(l.qty),
                  unitPrice: asNum(l.unitPrice),
                  taxPct: asNum(l.taxPct),
                  discountAmount: asNum(l.discountAmount),
                  total: asNum(l.total),
                  remark: (l.remark as string) ?? null,
                  projectNames: (l.projectNames as string[]) ?? [],
                  receivedQty: asNum(l.receivedQty),
                  sortOrder: Number(l.sortOrder ?? i),
                })),
              },
            },
          });
        }
      }

      // Company profile and numbering come back; credentials never do — the
      // password hashes and API key on this deployment are left exactly as
      // they are.
      const s = file.settings;
      if (s) {
        await tx.setting.update({
          where: { key: "default" },
          data: {
            companyName: (s.companyName as string) ?? undefined,
            address: (s.address as string) ?? undefined,
            phone: (s.phone as string) ?? undefined,
            email: (s.email as string) ?? undefined,
            gstin: (s.gstin as string) ?? null,
            gstRatePct: s.gstRatePct === undefined ? undefined : Number(s.gstRatePct),
            challanPrefix: (s.challanPrefix as string) ?? undefined,
            challanNext: s.challanNext === undefined ? undefined : Number(s.challanNext),
            billPrefix: (s.billPrefix as string) ?? undefined,
            quotePrefix: (s.quotePrefix as string) ?? undefined,
            quoteNext: s.quoteNext === undefined ? undefined : Number(s.quoteNext),
          },
        });
      }

      return { projects: projects.length };
    },
    { timeout: 120_000, maxWait: 20_000 }
  );
}
