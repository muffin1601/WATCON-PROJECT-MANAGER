// Quotation math — ported EXACTLY from the reference prototype's
// lineDisc / lineNetRate / lineNet / quoteSectionNet / quoteSectionShown /
// quoteTotals. This is the single source of truth for every rupee figure a
// quotation shows or prints.
//
// It is deliberately pure (plain numbers in, plain numbers out) so the server
// can recompute totals on every write and the editor can preview the same
// numbers live without the two ever disagreeing. The client's totals are
// never trusted or persisted — services/quotationService.ts always recomputes
// with these functions before saving.

export type ChargeMode = "INCLUDED" | "EXTRA";
export type InstallBasis = "PERCENT" | "LUMPSUM" | "PER_UNIT";

export interface QuoteLine {
  section?: string;
  qty: number;
  rate: number;
  /** null/undefined = fall back to the quotation's default discountPct */
  discPct?: number | null;
}

export interface QuoteTerms {
  discountPct: number;
  installMode: ChargeMode;
  installBasis: InstallBasis;
  installValue: number;
  transportMode: ChargeMode;
  transportAmount: number;
  gstMode: ChargeMode;
  gstPct: number;
  /** Hard round of the grand total; null/0 = no rounding */
  roundTo?: number | null;
  areaTotalsWithGst?: boolean;
}

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Money rounded to paise — prevents floating-point dust accumulating in stored totals. */
const money = (v: number): number => Math.round(v * 100) / 100;

/** Effective discount % for a line: its own override, else the quotation default. */
export function lineDisc(terms: Pick<QuoteTerms, "discountPct">, line: QuoteLine): number {
  return line.discPct !== undefined && line.discPct !== null ? n(line.discPct) : n(terms.discountPct);
}

/** Rate the client actually pays for one unit, after the line's discount. */
export function lineNetRate(terms: Pick<QuoteTerms, "discountPct">, line: QuoteLine): number {
  return money(n(line.rate) * (1 - lineDisc(terms, line) / 100));
}

/** Line amount after discount. */
export function lineNet(terms: Pick<QuoteTerms, "discountPct">, line: QuoteLine): number {
  return n(line.qty) * lineNetRate(terms, line);
}

export interface QuoteTotals {
  /** Total at list rates, before any discount. */
  subtotal: number;
  /** Total discount given across all lines. */
  discountAmount: number;
  /** subtotal − discount (the prototype's g1). */
  netAmount: number;
  /** Installation charged to the client, 0 when installation is included in rates. */
  installAmount: number;
  /** net + installation (the prototype's g2). */
  grandBeforeRounding: number;
  /** grandBeforeRounding, or the hard round-to value when one is set. */
  roundedAmount: number;
  transportAmount: number;
  gstAmount: number;
  /** Final payable: rounded + transport + GST. */
  grandTotal: number;
  totalQty: number;
}

export function quoteTotals(terms: QuoteTerms, lines: QuoteLine[]): QuoteTotals {
  const subtotal = lines.reduce((t, l) => t + n(l.qty) * n(l.rate), 0);
  const totalQty = lines.reduce((t, l) => t + n(l.qty), 0);
  const discountAmount = lines.reduce((t, l) => t + n(l.qty) * n(l.rate) * (lineDisc(terms, l) / 100), 0);
  const netAmount = subtotal - discountAmount;

  // Installation is charged three ways: a percentage of the discounted value,
  // a flat lump sum, or a rate applied to every unit on the quote.
  let installAmount = 0;
  if (terms.installMode === "EXTRA") {
    if (terms.installBasis === "LUMPSUM") installAmount = n(terms.installValue);
    else if (terms.installBasis === "PER_UNIT") installAmount = n(terms.installValue) * totalQty;
    else installAmount = netAmount * (n(terms.installValue) / 100);
  }

  const grandBeforeRounding = netAmount + installAmount;
  const roundTo = n(terms.roundTo);
  const roundedAmount = roundTo > 0 ? roundTo : grandBeforeRounding;

  const transportAmount = terms.transportMode === "EXTRA" ? n(terms.transportAmount) : 0;

  // GST applies to the rounded value plus transport — never to a figure that
  // already contains GST, which is why gstMode INCLUDED yields zero here
  // rather than back-calculating.
  const gstBase = roundedAmount + transportAmount;
  const gstAmount = terms.gstMode === "EXTRA" ? gstBase * (n(terms.gstPct) / 100) : 0;

  return {
    subtotal: money(subtotal),
    discountAmount: money(discountAmount),
    netAmount: money(netAmount),
    installAmount: money(installAmount),
    grandBeforeRounding: money(grandBeforeRounding),
    roundedAmount: money(roundedAmount),
    transportAmount: money(transportAmount),
    gstAmount: money(gstAmount),
    grandTotal: money(gstBase + gstAmount),
    totalQty,
  };
}

/** Ordered area names: the explicit list first, then any area only items mention. */
export function quoteSections(sections: string[], lines: QuoteLine[]): string[] {
  const seen: string[] = [];
  sections.forEach((s) => {
    if (s && !seen.includes(s)) seen.push(s);
  });
  lines.forEach((l) => {
    const s = (l.section || "").trim();
    if (s && !seen.includes(s)) seen.push(s);
  });
  return seen;
}

/** Discounted total of one area (blank string = the ungrouped "Other items"). */
export function quoteSectionNet(terms: Pick<QuoteTerms, "discountPct">, lines: QuoteLine[], section: string): number {
  return money(
    lines.filter((l) => (l.section || "").trim() === section).reduce((t, l) => t + lineNet(terms, l), 0)
  );
}

// The area total the CLIENT sees: that area's discounted value, plus its
// proportional share of installation and of any rounding, and optionally GST.
// Shares are proportional to the area's net value, so the area totals always
// add back up to the quotation's own grand total.
export function quoteSectionShown(terms: QuoteTerms, lines: QuoteLine[], section: string): number {
  const t = quoteTotals(terms, lines);
  const net = quoteSectionNet(terms, lines, section);
  const share = t.netAmount > 0 ? net / t.netAmount : 0;

  let amount = net + t.installAmount * share;
  if (n(terms.roundTo) > 0 && t.grandBeforeRounding > 0) {
    amount = amount * (t.roundedAmount / t.grandBeforeRounding);
  }
  if (terms.areaTotalsWithGst && terms.gstMode === "EXTRA") {
    amount += amount * (n(terms.gstPct) / 100);
  }
  return money(amount);
}
