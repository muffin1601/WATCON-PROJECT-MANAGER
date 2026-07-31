// Ported from the prototype's inr(), dfmt(), today() helpers — do not change rounding/locale.

export function inr(n: number | string | null | undefined): string {
  const num = Number(n) || 0;
  return (
    "₹ " +
    num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

export function dfmt(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
