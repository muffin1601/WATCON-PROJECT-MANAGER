/**
 * Numeric parsing for Indian commercial documents.
 *
 * The failure this file exists to prevent: a printed rate of `1,25,000.50`
 * reaching the Sales Order as `1.25`, `125` or `NaN`. Every number that comes
 * out of a spreadsheet cell, a CSV field or a PDF text run passes through
 * here, so there is exactly one place where grouping separators, rupee
 * symbols and accounting notation are interpreted.
 *
 * Design rules:
 *  - A value that cannot be read confidently returns `null`. It is NEVER
 *    silently coerced to 0 — a zero rate looks like a legitimate free-issue
 *    line, so guessing here would put a wrong price on a client bill.
 *  - Numbers that arrive already typed (an xlsx numeric cell, a formula's
 *    cached result) skip string parsing entirely and keep full precision.
 */

/** Currency markers and accounting noise stripped before parsing. */
const CURRENCY = /(?:₹|rs\.?|inr|₹)/gi;
/** Trailing "/-" and "only" that Indian invoices append to amounts. */
const TRAILING_NOISE = /(?:\/\s*-|\bonly\b|\/=)\s*$/i;

/**
 * Does this comma pattern look like digit grouping rather than a decimal
 * comma? Accepts both Western (`12,500`, `1,250,000`) and Indian lakh/crore
 * (`1,25,000`, `12,34,56,789`) grouping.
 */
function isGrouped(digits: string): boolean {
  return /^\d{1,3}(?:,\d{2})*(?:,\d{3})$/.test(digits) || /^\d{1,3}(?:,\d{3})+$/.test(digits);
}

/**
 * Parses one cell into a number, or null when it does not carry one.
 *
 * Handles: plain numbers, Indian and Western grouping, ₹/Rs/INR prefixes,
 * percent suffixes, parenthesised and trailing-minus negatives, values stored
 * as strings by the spreadsheet, and `1,250/-` style amounts.
 */
export function parseNumber(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input === "boolean") return null;
  if (input instanceof Date) return null;

  let text = String(input).trim();
  if (!text) return null;

  // Accounting negatives: (1,250) and 1,250- both mean -1250, and a totals
  // block writes a deduction as "(-) 3,44,251.50". Left unhandled, that last
  // form parses as nothing at all — which is why a PO's discount line was read
  // as having no amount.
  let negative = false;
  if (/^\(\s*-\s*\)/.test(text)) {
    negative = true;
    text = text.replace(/^\(\s*-\s*\)/, "").trim();
  }
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  if (/-\s*$/.test(text) && !/\/\s*-\s*$/.test(text)) {
    negative = true;
    text = text.replace(/-\s*$/, "").trim();
  }

  text = text
    .replace(TRAILING_NOISE, "")
    .replace(CURRENCY, "")
    // Non-breaking and thin spaces are used as grouping separators by some
    // exporters; a plain space can be too ("12 500").
    .replace(/[\s   ']/g, "")
    .replace(/%$/, "")
    .trim();

  if (!text) return null;
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  }
  if (text.startsWith("+")) text = text.slice(1);

  // Anything left that is not digits, commas or a single dot is not a number
  // — this is what keeps "4 Core Cable" or "N/A" from becoming a rate.
  if (!/^[\d.,]+$/.test(text)) return null;

  const dots = (text.match(/\./g) ?? []).length;
  const commas = (text.match(/,/g) ?? []).length;

  let normalised: string;
  if (dots > 1) {
    // "1.25.000" — dot used as a grouping separator (rare, but seen in
    // exports from European locales). Last dot cannot be the decimal point
    // if the trailing group is 3 digits, so treat them all as grouping.
    normalised = text.replace(/\./g, "");
    if (commas === 1 && /,\d{1,2}$/.test(text)) normalised = normalised.replace(",", ".");
    else normalised = normalised.replace(/,/g, "");
  } else if (dots === 1 && commas > 0) {
    // Both present: the dot is the decimal point, commas are grouping.
    normalised = text.replace(/,/g, "");
  } else if (commas > 0) {
    const grouped = isGrouped(text);
    if (grouped) {
      normalised = text.replace(/,/g, "");
    } else if (/^\d+,\d{1,2}$/.test(text)) {
      // "12,5" — not a valid grouping, so the comma is a decimal separator.
      normalised = text.replace(",", ".");
    } else {
      // Irregular grouping ("1,2500"). Commas are still separators here;
      // reading it as a decimal would shrink the value by orders of magnitude.
      normalised = text.replace(/,/g, "");
    }
  } else {
    normalised = text;
  }

  const value = Number(normalised);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/**
 * Units a quantity cell is routinely printed with: "2 Nos", "6.10 Mtr",
 * "120 RMT". The list is closed on purpose — a quantity column that happens to
 * hold "4 Core Cable" must still come back null rather than read as 4.
 */
const UNIT_SUFFIX =
  /^(nos?|pcs?|pieces?|sets?|units?|each|pairs?|rolls?|coils?|bags?|boxe?s?|lots?|ls|job|jobs|mtrs?|metres?|meters?|m|rmt|rft|ft|feet|inch(es)?|mm|cm|km|sq\.?\s?(ft|mt?r?|m)|sft|sqft|sqm|cft|cum|cbm|kgs?|kilograms?|gms?|tons?|mt|ltrs?|litres?|liters?|l)$/i;

/**
 * A quantity cell, which — unlike a rate — is frequently printed with its unit
 * in the same cell. Returns the number and the unit that accompanied it, so a
 * table with no separate UOM column still yields both.
 *
 * Without this, "2 Nos" parses to null and the row reaches the Sales Order
 * with a quantity of zero.
 */
export function parseQuantity(input: unknown): { value: number | null; unit: string } {
  const direct = parseNumber(input);
  if (direct !== null) return { value: direct, unit: "" };
  if (typeof input !== "string") return { value: null, unit: "" };

  const m = input.trim().match(/^([^A-Za-z]+)\s*([A-Za-z.\s]+)$/);
  if (!m) return { value: null, unit: "" };
  const unit = m[2]!.trim().replace(/\.$/, "");
  if (!UNIT_SUFFIX.test(unit)) return { value: null, unit: "" };
  const value = parseNumber(m[1]);
  return value === null ? { value: null, unit: "" } : { value, unit };
}

/** parseNumber, but only accepts a value strictly greater than zero. */
export function parsePositive(input: unknown): number | null {
  const n = parseNumber(input);
  return n !== null && n > 0 ? n : null;
}

/**
 * True when the cell reads as a number. Used to tell a data row from a
 * heading row, so it must agree exactly with parseNumber.
 */
export function looksNumeric(input: unknown): boolean {
  return parseNumber(input) !== null;
}

/**
 * Rounds to `dp` decimals without the float drift of `Math.round(x*100)/100`
 * on values like 1234.565. Rates are money and are compared against printed
 * amounts, so the last paisa matters.
 */
export function round(value: number, dp = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** dp;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
