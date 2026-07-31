import { prisma } from "../lib/prisma";
import type { SettingsInput } from "../modules/settings/schema";

export async function updateSettings(input: SettingsInput) {
  return prisma.setting.update({
    where: { key: "default" },
    data: {
      companyName: input.companyName,
      address: input.address,
      phone: input.phone,
      email: input.email,
      gstin: input.gstin || null,
      gstRatePct: input.gstRatePct,
      challanPrefix: input.challanPrefix,
      challanNext: input.challanNext,
      billPrefix: input.billPrefix,
      appPassword: input.appPassword,
    },
  });
}

// Ported from the prototype's "Export data backup (JSON)" button — a full
// data dump. "Import backup" is deliberately NOT implemented: in the
// prototype that was a client-side localStorage overwrite with no real
// consequence; here it would mean bulk-overwriting a live production
// database from an uploaded file, which is a different risk profile
// entirely and needs an explicit human decision, not a button. See
// KNOWN_LIMITATIONS.md.
export async function exportAllData() {
  const [settings, projects] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "default" } }),
    prisma.project.findMany({
      include: {
        items: true,
        challans: { include: { items: true, extraItems: true, documents: true } },
        bills: { include: { lines: true } },
        payments: { include: { documents: true } },
        discounts: true,
        amendments: { include: { documents: true } },
        documents: true,
      },
    }),
  ]);
  return { exportedAt: new Date().toISOString(), settings, projects };
}
