import { z } from "zod";

// Same shape the prototype's extractOrder() produced — restored for the
// local (no cloud AI) auto-read flow. Every field is best-effort and lands
// in an editable form; nothing is saved without user review.
export const extractedOrderSchema = z.object({
  projectName: z.string().default(""), // Zoho "Ref# : <project>" — the PO's project reference
  clientName: z.string().default(""),
  poNumber: z.string().default(""),
  poDate: z.string().default(""), // ISO yyyy-mm-dd when confidently parsed, else ""
  siteAddress: z.string().default(""),
  terms: z.object({
    gst: z.enum(["included", "extra", "unknown"]).default("unknown"),
    transport: z.enum(["included", "extra", "unknown"]).default("unknown"),
    payment: z.string().default(""),
  }),
  // From the totals block, when present ("GST@ 18%", "Discount(4.00%) (-) 3,44,251.50")
  gstRatePct: z.number().nullable().default(null),
  discountAmount: z.number().nullable().default(null),
  discountPct: z.number().nullable().default(null),
  items: z
    .array(
      z.object({
        description: z.string(),
        unit: z.string().default("Nos"),
        qty: z.number().default(0),
        rate: z.number().default(0),
        // Added by the AI document engine. All optional so responses from the
        // older local parser still satisfy this schema unchanged.
        make: z.string().default(""),
        specification: z.string().default(""),
        code: z.string().default(""),
        amount: z.number().default(0),
        taxPct: z.number().default(0),
        remarks: z.string().default(""),
        sourcePage: z.number().default(0),
        confidence: z.number().default(1),
      })
    )
    .default([]),
  // Document-level fields the AI engine adds; ignored by callers that predate it.
  documentType: z.enum(["BOQ", "PURCHASE_ORDER", "CHALLAN", "UNKNOWN"]).default("UNKNOWN"),
  confidence: z.number().default(1),
  documentTotal: z.number().default(0),
  remarks: z.string().default(""),
  /** Rows the reviewer should check before saving (0-based indexes into items). */
  flaggedRows: z.array(z.number()).default([]),
  issues: z
    .array(
      z.object({
        severity: z.enum(["error", "warning"]),
        rowIndex: z.number().nullable(),
        field: z.string().nullable(),
        message: z.string(),
      })
    )
    .default([]),
});
/**
 * Consumer-side type: every field is present, because Zod has applied its
 * defaults. This is what the New Project form reads.
 */
export type ExtractedOrder = z.output<typeof extractedOrderSchema>;

/**
 * Producer-side type: fields with defaults are optional. Used by the local
 * fallback parser (services/import/orderParser.ts), which predates the AI
 * engine and legitimately does not populate the AI-only fields.
 */
export type ExtractedOrderInput = z.input<typeof extractedOrderSchema>;

export const EMPTY_EXTRACTED_ORDER: ExtractedOrderInput = {
  projectName: "",
  clientName: "",
  poNumber: "",
  poDate: "",
  siteAddress: "",
  terms: { gst: "unknown", transport: "unknown", payment: "" },
  gstRatePct: null,
  discountAmount: null,
  discountPct: null,
  items: [],
};
