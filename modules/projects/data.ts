import { prisma } from "../../lib/prisma";
import { toNum } from "../../lib/decimal";
import type { FinProject } from "../../services/financials";

// project.status stored as e.g. IN_PROGRESS; display labels match the
// prototype's <select> options exactly.
export const PROJECT_STATUS_LABEL: Record<string, string> = {
  IN_PROGRESS: "In Progress",
  ON_HOLD: "On Hold",
  COMPLETED: "Completed",
};

export const PROJECT_TYPE_LABEL: Record<string, string> = {
  SWIMMING_POOL: "Swimming Pool",
  WATER_BODY_FOUNTAIN: "Water Body / Fountain",
  TILES_SUPPLY: "Tiles — Supply",
  TILES_SUPPLY_INSTALL: "Tiles — Supply & Install",
  FIREPLACE: "Fireplace",
  SAUNA_STEAM_SPA: "Sauna / Steam / Spa",
  MIXED_SCOPE: "Mixed Scope",
};

const projectWithFinancials = {
  items: true,
  orders: { include: { documents: true } },
  challans: { include: { items: true, extraItems: true, documents: true } },
  transports: { include: { documents: true } },
  discounts: true,
  amendments: { include: { documents: true } },
  bills: { include: { lines: true } },
  payments: { include: { documents: true } },
  documents: true,
} as const;

export type ProjectForList = Awaited<ReturnType<typeof listProjectsForDashboard>>[number];

// relationLoadStrategy "join" = one SQL round trip instead of ~10 — the
// dominant cost with a WAN-remote database. See the generator block in
// prisma/schema.prisma.
export async function listProjectsForDashboard() {
  return prisma.project.findMany({
    relationLoadStrategy: "join",
    include: projectWithFinancials,
    orderBy: { createdAt: "desc" },
  });
}

export async function getProjectDetail(id: string) {
  return prisma.project.findUnique({
    relationLoadStrategy: "join",
    where: { id },
    include: projectWithFinancials,
  });
}

// Maps a Prisma Project (with the relations above) into the plain-number
// shape services/financials.ts expects.
export function toFinProject(p: {
  items: { id: string; description: string; unit: string; qty: unknown; rate: unknown }[];
  challans: {
    id: string;
    date: Date;
    manualValue: unknown;
    items: { itemId: string; qty: unknown; extraQty: unknown }[];
    extraItems: { description: string; unit: string; qty: unknown; rate: unknown }[];
  }[];
  discounts: { amount: unknown }[];
  amendments: { valueChange: unknown; applied?: boolean }[];
  transports?: { date: Date; amount: unknown }[];
  termsGst: string;
  termsTransport?: string;
}): FinProject {
  return {
    items: p.items.map((i) => ({
      id: i.id,
      description: i.description,
      unit: i.unit,
      qty: toNum(i.qty as never),
      rate: toNum(i.rate as never),
    })),
    challans: p.challans.map((c) => ({
      id: c.id,
      date: c.date.toISOString().slice(0, 10),
      manualValue: c.manualValue ? toNum(c.manualValue as never) : null,
      items: c.items.map((ci) => ({
        itemId: ci.itemId,
        qty: toNum(ci.qty as never),
        extraQty: toNum(ci.extraQty as never),
      })),
      extraItems: c.extraItems.map((x) => ({
        description: x.description,
        unit: x.unit,
        qty: toNum(x.qty as never),
        rate: toNum(x.rate as never),
      })),
    })),
    discounts: p.discounts.map((d) => ({ amount: toNum(d.amount as never) })),
    amendments: p.amendments.map((a) => ({ valueChange: toNum(a.valueChange as never), applied: a.applied ?? false })),
    transports: (p.transports || []).map((t) => ({ date: t.date.toISOString().slice(0, 10), amount: toNum(t.amount as never) })),
    terms: {
      gst: p.termsGst === "EXTRA" ? "extra" : "included",
      transport: p.termsTransport === "INCLUDED" ? "included" : "extra",
    },
  };
}
