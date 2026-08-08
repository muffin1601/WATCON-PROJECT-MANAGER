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
  const [settingsRow, projects] = await Promise.all([
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
  // The deletion password hash is a credential, not business data — it has no
  // place in a JSON backup that gets downloaded and mailed around.
  const settings = settingsRow ? { ...settingsRow, deletePasswordHash: undefined } : settingsRow;
  return { exportedAt: new Date().toISOString(), settings, projects };
}
