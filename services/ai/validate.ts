import { LOW_CONFIDENCE_THRESHOLD } from "./config";
import type { AiOrderResult, AiChallanResult } from "../../modules/ai/schema";

/**
 * Validation layer.
 *
 * Two rules govern everything here, both straight from the spec:
 *
 *  1. Validation NEVER blocks and NEVER discards. A flagged row is still
 *     returned, still shown, still editable. "If confidence below threshold,
 *     highlight only those rows, allow user correction, continue."
 *  2. Issues are addressed to a human reviewer, so each message names the row
 *     and says what to check — not "validation failed".
 */

export type IssueSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: IssueSeverity;
  /** 0-based index into the items array, or null for document-level issues. */
  rowIndex: number | null;
  field: string | null;
  message: string;
}

export interface ValidationReport {
  issues: ValidationIssue[];
  /** Row indexes the UI should highlight for review. */
  flaggedRows: number[];
  /** True when nothing needs a human's attention. */
  clean: boolean;
}

function buildReport(issues: ValidationIssue[]): ValidationReport {
  const flagged = Array.from(
    new Set(issues.filter((i) => i.rowIndex !== null).map((i) => i.rowIndex as number))
  ).sort((a, b) => a - b);
  return { issues, flaggedRows: flagged, clean: issues.length === 0 };
}

/**
 * Normalised key for duplicate detection.
 *
 * Separators are removed outright rather than collapsed to a single space,
 * because the same item is routinely typed both ways across a document —
 * "Heat pump 21kW" on one page and "heat pump 21 kw" on the next. Collapsing
 * to spaces leaves "21kw" and "21 kw" distinct and the duplicate slips
 * through, which is the failure this key exists to catch.
 */
function dupKey(description: string, unit: string): string {
  const squashed = description.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `${squashed}|${unit.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
}

export function validateOrder(result: AiOrderResult): ValidationReport {
  const issues: ValidationIssue[] = [];
  const { items, documentTotal } = result.extractedData;

  // Problems the model itself reported about the document.
  for (const message of result.validation) {
    issues.push({ severity: "warning", rowIndex: null, field: null, message });
  }

  if (items.length === 0) {
    issues.push({
      severity: "error",
      rowIndex: null,
      field: "items",
      message: "No billable items were found in this document. Check that the correct file was uploaded, or add items manually.",
    });
  }

  const seen = new Map<string, number>();

  items.forEach((item, index) => {
    const label = item.description.trim() || `Row ${index + 1}`;

    if (!item.description.trim()) {
      issues.push({ severity: "error", rowIndex: index, field: "description", message: `Row ${index + 1} has no description.` });
    }
    if (item.qty <= 0) {
      issues.push({ severity: "error", rowIndex: index, field: "qty", message: `"${label}" has no quantity.` });
    }
    if (item.rate <= 0) {
      issues.push({ severity: "warning", rowIndex: index, field: "rate", message: `"${label}" has a rate of zero — confirm this is intentional.` });
    }
    if (!item.unit.trim()) {
      issues.push({ severity: "warning", rowIndex: index, field: "unit", message: `"${label}" has no unit of measure.` });
    }

    // Line arithmetic: qty x rate should reproduce the printed amount.
    if (item.amount > 0) {
      const computed = item.qty * item.rate;
      const tolerance = Math.max(1, item.amount * 0.01);
      if (Math.abs(computed - item.amount) > tolerance) {
        issues.push({
          severity: "warning",
          rowIndex: index,
          field: "rate",
          message: `"${label}": quantity x rate is ${Math.round(computed).toLocaleString("en-IN")} but the document prints ${Math.round(item.amount).toLocaleString("en-IN")}.`,
        });
      }
    }

    if (item.confidence < LOW_CONFIDENCE_THRESHOLD) {
      issues.push({
        severity: "warning",
        rowIndex: index,
        field: null,
        message: `"${label}" was read with low confidence (${Math.round(item.confidence * 100)}%) — please verify it against the document.`,
      });
    }

    const key = dupKey(item.description, item.unit);
    const firstAt = seen.get(key);
    if (firstAt !== undefined) {
      issues.push({
        severity: "warning",
        rowIndex: index,
        field: "description",
        message: `"${label}" repeats row ${firstAt + 1}. Keep it only if the document genuinely lists it twice.`,
      });
    } else {
      seen.set(key, index);
    }
  });

  // Document-level reconciliation. Rates may already have been scaled during
  // extraction, so anything still off here is worth a human's eyes.
  if (documentTotal > 0 && items.length > 0) {
    const computed = items.reduce((sum, it) => sum + it.qty * it.rate, 0);
    const drift = Math.abs(computed - documentTotal) / documentTotal;
    // A document's stated total is the net figure: items, less its discount,
    // plus its GST. When the discount and tax the document itself prints
    // reproduce that total, the rows are proven complete — warning "some rows
    // may be missing" there is false, and it fired on every correctly-read PO
    // that carried a discount or GST line.
    const { discountAmount, discountPct, gstRatePct } = result.extractedData;
    const discountValue = discountAmount > 0 ? discountAmount : (computed * discountPct) / 100;
    const reconciled = (computed - discountValue) * (1 + gstRatePct / 100);
    const explained = Math.abs(reconciled - documentTotal) <= Math.max(1, documentTotal * 0.01);
    if (drift > 0.01 && !explained) {
      issues.push({
        severity: "warning",
        rowIndex: null,
        field: "documentTotal",
        message: `Item total is ${Math.round(computed).toLocaleString("en-IN")} against a document total of ${Math.round(documentTotal).toLocaleString("en-IN")} (${(drift * 100).toFixed(1)}% apart). Some rows may be missing.`,
      });
    }
  }

  const report = buildReport(issues);

  // A single sentence at the top of the list, so the reviewer knows the size
  // of the job before reading twelve individual notes. Prepended after the
  // report is built so it cannot itself flag a row.
  if (report.flaggedRows.length > 0) {
    report.issues.unshift({
      severity: "warning",
      rowIndex: null,
      field: null,
      message: `${report.flaggedRows.length} of ${items.length} item(s) require review because their product, quantity, rate or amount could not be confidently identified. Every value shown is exactly as read from the document — nothing was substituted.`,
    });
  }
  return report;
}

export function validateChallan(result: AiChallanResult): ValidationReport {
  const issues: ValidationIssue[] = [];
  const { items, challanNo } = result.extractedData;

  for (const message of result.validation) {
    issues.push({ severity: "warning", rowIndex: null, field: null, message });
  }

  if (!challanNo.trim()) {
    issues.push({
      severity: "error",
      rowIndex: null,
      field: "challanNo",
      message: "No challan number was found — enter it before saving.",
    });
  }
  if (items.length === 0) {
    issues.push({
      severity: "error",
      rowIndex: null,
      field: "items",
      message: "No goods lines were found on this challan.",
    });
  }

  const seen = new Map<string, number>();
  items.forEach((item, index) => {
    const label = item.description.trim() || `Row ${index + 1}`;
    if (!item.description.trim()) {
      issues.push({ severity: "error", rowIndex: index, field: "description", message: `Row ${index + 1} has no description.` });
    }
    if (item.qty <= 0) {
      issues.push({ severity: "error", rowIndex: index, field: "qty", message: `"${label}" has no quantity.` });
    }
    if (item.confidence < LOW_CONFIDENCE_THRESHOLD) {
      issues.push({
        severity: "warning",
        rowIndex: index,
        field: null,
        message: `"${label}" was read with low confidence (${Math.round(item.confidence * 100)}%) — please verify it.`,
      });
    }
    const key = dupKey(item.description, item.unit);
    const firstAt = seen.get(key);
    if (firstAt !== undefined) {
      issues.push({
        severity: "warning",
        rowIndex: index,
        field: "description",
        message: `"${label}" repeats row ${firstAt + 1}.`,
      });
    } else {
      seen.set(key, index);
    }
  });

  return buildReport(issues);
}
