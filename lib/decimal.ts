import type { Decimal } from "@prisma/client/runtime/library";

// Prisma returns Decimal fields as Decimal.js instances; the financial math
// in services/financials.ts works on plain numbers. Centralize the coercion.
export function toNum(value: Decimal | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}
