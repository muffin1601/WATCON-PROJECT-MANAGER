import { prisma } from "./prisma";
import { toNum } from "./decimal";

// The prototype kept one global settings object; we model that as a single
// row keyed "default" (see prisma/seed.ts). getSettings() creates it lazily
// with the same defaults as the HTML's initial `state.settings`.
export async function getSettings() {
  const existing = await prisma.setting.findUnique({ where: { key: "default" } });
  if (existing) return existing;
  return prisma.setting.create({
    data: {
      key: "default",
      companyName: "Watcon International",
      address: "S-36, Okhla Phase 2, New Delhi 110020",
      phone: "9999969661",
      email: "info@watcon.net",
      gstRatePct: 18,
      challanPrefix: "WC/CH/",
      challanNext: 1,
      billPrefix: "RA-",
    },
  });
}

export async function getGstRatePct(): Promise<number> {
  const s = await getSettings();
  return toNum(s.gstRatePct);
}
