import type { AiOrderResult, AiChallanResult } from "../../modules/ai/schema";
import type { ExtractedOrder } from "../../modules/import/schema";
import type { ValidationReport } from "./validate";
import { normaliseMake, splitInlineMake } from "../import/tableExtract";

/**
 * Mapper layer — the boundary between AI output and the application.
 *
 * Its whole job is that **nothing downstream changes**. The New Project form
 * already consumes `ExtractedOrder`; it keeps consuming exactly that, so no
 * screen, field or workflow had to be redesigned to switch the engine from
 * regex heuristics to Claude. New AI-only data (make, confidence, flagged
 * rows) rides along as optional fields the older callers ignore.
 */

function normaliseDate(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return "";
}

/** AI order result -> the exact shape the New Project form already fills from. */
export function toExtractedOrder(ai: AiOrderResult, report: ValidationReport): ExtractedOrder {
  const d = ai.extractedData;

  return {
    projectName: d.projectName.trim(),
    // The prototype treated the party named on the PO as the client. A PO
    // issued *to* Watcon names Watcon as vendor and the buyer as client, so
    // prefer clientName and fall back to vendorName only when it is absent.
    clientName: d.clientName.trim() || d.vendorName.trim(),
    poNumber: d.poNumber.trim(),
    poDate: normaliseDate(d.poDate),
    siteAddress: d.siteAddress.trim() || d.deliveryAddress.trim(),
    terms: {
      gst: d.terms.gst,
      transport: d.terms.transport,
      payment: d.terms.payment.trim(),
    },
    gstRatePct: d.gstRatePct > 0 ? d.gstRatePct : null,
    discountAmount: d.discountAmount > 0 ? d.discountAmount : null,
    discountPct: d.discountPct > 0 ? d.discountPct : null,
    items: d.items.map((it) => {
      // Make normalisation happens HERE, at the boundary every engine passes
      // through, rather than in any one reader. Whatever read the file —
      // structured spreadsheet parsing, the PDF table reader, Claude, or the
      // local fallback — an item reaches the Sales Order with the make in the
      // make field and not buried in its description. That matters because
      // `description + make` is the Items & Stocks master key: the same
      // product read two different ways must produce one stock line, not two.
      const columnMake = normaliseMake(it.make);
      const resolved = columnMake
        ? { description: it.description.trim(), make: columnMake }
        : splitInlineMake(it.description.trim());

      return {
      description: resolved.description,
      unit: it.unit.trim() || "Nos",
      qty: it.qty,
      rate: it.rate,
      make: resolved.make,
      specification: it.specification.trim(),
      code: it.code.trim(),
      amount: it.amount,
      taxPct: it.taxPct,
      remarks: it.remarks.trim(),
      sourcePage: it.sourcePage,
      confidence: it.confidence,
      };
    }),
    documentType: ai.documentType,
    confidence: ai.confidence,
    documentTotal: d.documentTotal,
    remarks: d.remarks.trim(),
    flaggedRows: report.flaggedRows,
    issues: report.issues,
  };
}

/**
 * AI challan result -> the fields the Attach Challan modal fills.
 *
 * Item *matching* against the Sales Order is deliberately not done here: it
 * needs the project's current items from the database, which is a concern of
 * services/ai/matching.ts, not of shape translation.
 */
export interface MappedChallan {
  no: string;
  date: string;
  vehicle: string;
  driver: string;
  remarks: string;
  clientName: string;
  projectName: string;
  siteAddress: string;
  poNumber: string;
  totalValue: number;
  items: { description: string; unit: string; qty: number; code: string; confidence: number }[];
  flaggedRows: number[];
  issues: ValidationReport["issues"];
  confidence: number;
}

export function toMappedChallan(ai: AiChallanResult, report: ValidationReport): MappedChallan {
  const d = ai.extractedData;
  return {
    no: d.challanNo.trim(),
    date: normaliseDate(d.date),
    vehicle: d.vehicle.trim(),
    driver: d.driver.trim(),
    remarks: d.remarks.trim(),
    clientName: d.clientName.trim(),
    projectName: d.projectName.trim(),
    siteAddress: d.siteAddress.trim(),
    poNumber: d.poNumber.trim(),
    totalValue: d.totalValue,
    items: d.items.map((it) => ({
      description: it.description.trim(),
      unit: it.unit.trim() || "Nos",
      qty: it.qty,
      code: it.code.trim(),
      confidence: it.confidence,
    })),
    flaggedRows: report.flaggedRows,
    issues: report.issues,
    confidence: ai.confidence,
  };
}
