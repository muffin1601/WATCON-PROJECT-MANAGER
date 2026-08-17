// Module / action permission vocabulary, taken verbatim from the prototype's
// MODULES and ACTIONS arrays so the Admin grid reads exactly the same.

export const MODULES = [
  ["projects", "Projects"],
  ["salesorder", "Sales Order"],
  ["challans", "Challans"],
  ["transport", "Transport"],
  ["bills", "Running Bills"],
  ["payments", "Payments"],
  ["adjust", "Discounts & Amendments"],
  ["costing", "Project Costing"],
  ["accounts", "Site Accounts"],
  ["documents", "Documents"],
  ["quotes", "Quotations"],
  ["customers", "Customers & References"],
  ["items", "Items & Stocks / Item Sheet"],
  ["purchase", "Rate Inquiry & Purchase Orders"],
  ["settings", "Settings & Backup"],
] as const;

export const ACTIONS = [
  ["view", "View"],
  ["create", "Create"],
  ["amend", "Amend / Edit"],
  ["delete", "Delete"],
] as const;

export type ModuleKey = (typeof MODULES)[number][0];
export type ActionKey = (typeof ACTIONS)[number][0];

export type ModulePerms = Partial<Record<ActionKey, boolean>>;
export type PermissionMap = Partial<Record<ModuleKey, ModulePerms>>;

export interface PermissionSubject {
  role: "ADMIN" | "USER";
  perms: PermissionMap | null | undefined;
}

// Ported from the prototype's can(mod, act): admins always pass, and "view" is
// implied by holding any right on the module — you cannot create something you
// are not allowed to look at.
export function can(user: PermissionSubject | null | undefined, mod: ModuleKey, act: ActionKey): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  const p = (user.perms || {})[mod] || {};
  if (act === "view") return !!(p.view || p.create || p.amend || p.delete);
  return !!p[act];
}

export function moduleLabel(mod: string): string {
  return MODULES.find((m) => m[0] === mod)?.[1] ?? mod;
}

export function actionLabel(act: string): string {
  return ACTIONS.find((a) => a[0] === act)?.[1] ?? act;
}

// Strips anything that isn't a known module/action so a hand-crafted request
// cannot smuggle arbitrary keys into the stored permission map.
export function sanitizePerms(input: unknown): PermissionMap {
  const out: PermissionMap = {};
  if (!input || typeof input !== "object") return out;
  const src = input as Record<string, unknown>;
  for (const [mod] of MODULES) {
    const raw = src[mod];
    if (!raw || typeof raw !== "object") continue;
    const rawMod = raw as Record<string, unknown>;
    const perms: ModulePerms = {};
    for (const [act] of ACTIONS) {
      if (rawMod[act] === true) perms[act] = true;
    }
    if (Object.keys(perms).length) out[mod] = perms;
  }
  return out;
}

// One-line "Projects (VCAD), Challans (V)" summary used by the Admin table.
export function accessSummary(user: PermissionSubject): string {
  if (user.role === "ADMIN") return "All modules — full access";
  const parts = MODULES.map(([mod, label]) => {
    const p = (user.perms || {})[mod] || {};
    const letters = ACTIONS.filter(([act]) => p[act])
      .map(([, actLabel]) => actLabel[0])
      .join("");
    return letters ? `${label} (${letters})` : null;
  }).filter(Boolean);
  return parts.length ? parts.join(", ") : "No access";
}
