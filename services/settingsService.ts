import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/deletePassword";
import type { SettingsInput } from "../modules/settings/schema";

export async function updateSettings(input: SettingsInput) {
  return prisma.setting.update({
    where: { key: "default" },
    data: {
      // Only ever written as a hash, and only when a new one was typed — a
      // blank field means "keep the existing password", not "clear it".
      ...(input.deletePassword
        ? { deletePasswordHash: await hashPassword(input.deletePassword) }
        : {}),
      // Blank leaves the stored key alone; the explicit sentinel clears it.
      // The value is never logged and never read back to the browser.
      ...(input.anthropicApiKey
        ? { anthropicApiKey: input.anthropicApiKey === "__CLEAR__" ? null : input.anthropicApiKey }
        : {}),
      companyName: input.companyName,
      address: input.address,
      phone: input.phone,
      email: input.email,
      gstin: input.gstin || null,
      gstRatePct: input.gstRatePct,
      challanPrefix: input.challanPrefix,
      challanNext: input.challanNext,
      billPrefix: input.billPrefix,
      quotePrefix: input.quotePrefix,
      quoteNext: input.quoteNext,
      appPassword: input.appPassword,
    },
  });
}

// Ported from the prototype's "Export data backup (JSON)" button — a full data
// dump, and the format "Import backup" expects.
//
// IMPORTANT: this must stay in step with importBackup() in
// services/backupService.ts. Import replaces what it restores, so anything
// missing here would be silently lost on a restore. Every business table is
// included for that reason; if you add a table, add it in BOTH places.
export async function exportAllData() {
  const [settingsRow, projects, customers, quotations, vendors, catalog, itemMasters, rfqs, purchaseOrders] =
    await Promise.all([
      prisma.setting.findUnique({ where: { key: "default" } }),
      prisma.project.findMany({
        include: {
          items: true,
          orders: true,
          challans: { include: { items: true, extraItems: true, documents: true } },
          transports: { include: { documents: true } },
          bills: { include: { lines: true } },
          payments: { include: { documents: true } },
          discounts: true,
          amendments: { include: { documents: true } },
          documents: true,
        },
      }),
      prisma.customer.findMany(),
      prisma.quotation.findMany({ include: { items: true } }),
      prisma.vendor.findMany(),
      prisma.catalogItem.findMany({ include: { components: true } }),
      prisma.itemMaster.findMany({ include: { entries: true } }),
      prisma.rfq.findMany({ include: { lines: true, vendors: true, responses: { include: { offers: true } } } }),
      prisma.purchaseOrder.findMany({ include: { lines: true } }),
    ]);

  // Credentials are not business data and have no place in a JSON file that
  // gets downloaded and mailed around.
  const settings = settingsRow
    ? { ...settingsRow, deletePasswordHash: undefined, anthropicApiKey: undefined }
    : settingsRow;

  return {
    exportedAt: new Date().toISOString(),
    settings,
    projects,
    customers,
    quotations,
    vendors,
    catalog,
    itemMasters,
    rfqs,
    purchaseOrders,
  };
}
