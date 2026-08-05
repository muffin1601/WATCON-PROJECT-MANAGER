import { z } from "zod";

/**
 * The AI document engine's wire contract, in the exact envelope the spec
 * requires:
 *
 *   { documentType, confidence, extractedData, validation, warnings }
 *
 * Each shape is declared twice, deliberately:
 *
 *  - `*_JSON_SCHEMA` is sent to Claude as `output_config.format`, which
 *    *constrains generation* — the reply cannot be malformed or miss a field.
 *  - the Zod schema re-validates the parsed reply on our side, so a schema
 *    drift between this file and the model's output surfaces as a clean
 *    error instead of an `undefined` reaching the database.
 *
 * Structured outputs restricts the JSON Schema dialect: every object needs
 * `additionalProperties: false` and a complete `required` list, and numeric /
 * string constraints (minimum, minLength, ...) are not supported. Absent
 * values are represented as `""` or `0` rather than null for the same reason.
 */

export const DOCUMENT_TYPES = ["BOQ", "PURCHASE_ORDER", "CHALLAN", "UNKNOWN"] as const;
export type AiDocumentType = (typeof DOCUMENT_TYPES)[number];

// ---------------------------------------------------------------- items

const orderItemZ = z.object({
  description: z.string(),
  make: z.string(),
  specification: z.string(),
  code: z.string(),
  unit: z.string(),
  qty: z.number(),
  rate: z.number(),
  amount: z.number(),
  taxPct: z.number(),
  remarks: z.string(),
  sourcePage: z.number(),
  confidence: z.number(),
});
export type AiOrderItem = z.infer<typeof orderItemZ>;

const ORDER_ITEM_JSON = {
  type: "object",
  additionalProperties: false,
  required: [
    "description",
    "make",
    "specification",
    "code",
    "unit",
    "qty",
    "rate",
    "amount",
    "taxPct",
    "remarks",
    "sourcePage",
    "confidence",
  ],
  properties: {
    description: { type: "string", description: "Short item description, max 15 words. Prefix with its section when helpful, e.g. 'Jacuzzi - Piping cPVC 2.5 inch'." },
    make: { type: "string", description: "Brand/make if stated, else empty string. If a row lists several makes, use the first." },
    specification: { type: "string", description: "Key specification text if the document carries one (grade, schedule, size), else empty string." },
    code: { type: "string", description: "Item/HSN/SAC code if printed, else empty string." },
    unit: { type: "string", description: "Unit of measure, e.g. Nos, Sqft, Mtr, Lot, LS. Use 'Nos' when absent." },
    qty: { type: "number", description: "Quantity as a plain number, no commas." },
    rate: { type: "number", description: "Per-unit rate as a plain number. Never the line amount." },
    amount: { type: "number", description: "Line amount as printed. Use 0 if not printed." },
    taxPct: { type: "number", description: "Line-level tax percentage if printed per row, else 0." },
    remarks: { type: "string", description: "Row-level remark/note if present, else empty string." },
    sourcePage: { type: "number", description: "1-based page number this row was read from." },
    confidence: { type: "number", description: "0.0-1.0 confidence that this row was read correctly. Be honest: use below 0.75 for smudged, ambiguous or reconstructed values." },
  },
} as const;

// ---------------------------------------------------------------- order

const orderDataZ = z.object({
  projectName: z.string(),
  clientName: z.string(),
  vendorName: z.string(),
  poNumber: z.string(),
  poDate: z.string(),
  siteAddress: z.string(),
  deliveryAddress: z.string(),
  gstin: z.string(),
  terms: z.object({
    gst: z.enum(["included", "extra", "unknown"]),
    transport: z.enum(["included", "extra", "unknown"]),
    payment: z.string(),
  }),
  gstRatePct: z.number(),
  discountPct: z.number(),
  discountAmount: z.number(),
  discountNote: z.string(),
  ratesAreGstInclusive: z.boolean(),
  documentTotal: z.number(),
  remarks: z.string(),
  items: z.array(orderItemZ),
});

export const aiOrderResultSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  confidence: z.number(),
  extractedData: orderDataZ,
  validation: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type AiOrderResult = z.infer<typeof aiOrderResultSchema>;

export const ORDER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["documentType", "confidence", "extractedData", "validation", "warnings"],
  properties: {
    documentType: { type: "string", enum: [...DOCUMENT_TYPES], description: "What this document actually is, judged from its own content — not from what was expected." },
    confidence: { type: "number", description: "0.0-1.0 overall confidence in this extraction." },
    validation: { type: "array", items: { type: "string" }, description: "Problems found in the document itself: totals that do not add up, missing quantities, duplicated rows." },
    warnings: { type: "array", items: { type: "string" }, description: "Anything the reviewer should check, e.g. pages that were unreadable." },
    extractedData: {
      type: "object",
      additionalProperties: false,
      required: [
        "projectName",
        "clientName",
        "vendorName",
        "poNumber",
        "poDate",
        "siteAddress",
        "deliveryAddress",
        "gstin",
        "terms",
        "gstRatePct",
        "discountPct",
        "discountAmount",
        "discountNote",
        "ratesAreGstInclusive",
        "documentTotal",
        "remarks",
        "items",
      ],
      properties: {
        projectName: { type: "string", description: "Project/reference name, e.g. Zoho's 'Ref# :' value. Empty string if absent." },
        clientName: { type: "string", description: "The customer this order is for. Empty string if absent." },
        vendorName: { type: "string", description: "The supplier named on the document. Empty string if absent." },
        poNumber: { type: "string", description: "PO / reference number. Empty string if absent." },
        poDate: { type: "string", description: "Document date as YYYY-MM-DD. Empty string if absent or ambiguous." },
        siteAddress: { type: "string", description: "Site / project location. Empty string if absent." },
        deliveryAddress: { type: "string", description: "Delivery / ship-to address if it differs from the site. Empty string otherwise." },
        gstin: { type: "string", description: "Customer GSTIN if printed. Empty string otherwise." },
        terms: {
          type: "object",
          additionalProperties: false,
          required: ["gst", "transport", "payment"],
          properties: {
            gst: { type: "string", enum: ["included", "extra", "unknown"] },
            transport: { type: "string", enum: ["included", "extra", "unknown"] },
            payment: { type: "string", description: "Payment terms text. Empty string if absent." },
          },
        },
        gstRatePct: { type: "number", description: "GST percentage stated on the document, else 0." },
        discountPct: { type: "number", description: "Discount percentage applied, else 0." },
        discountAmount: { type: "number", description: "Lump-sum discount amount applied, else 0." },
        discountNote: { type: "string", description: "One line describing the discount, e.g. '25% discount applied on equipment total'. Empty string if none." },
        ratesAreGstInclusive: { type: "boolean", description: "True only when the returned rates already contain GST." },
        documentTotal: { type: "number", description: "Final total payable per the document, on the same GST basis as the rates. 0 if not stated." },
        remarks: { type: "string", description: "Document-level notes/remarks. Empty string if absent." },
        items: { type: "array", items: ORDER_ITEM_JSON },
      },
    },
  },
} as const;

// -------------------------------------------------------------- challan

const challanItemZ = z.object({
  description: z.string(),
  unit: z.string(),
  qty: z.number(),
  code: z.string(),
  remarks: z.string(),
  confidence: z.number(),
});
export type AiChallanItem = z.infer<typeof challanItemZ>;

export const aiChallanResultSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  confidence: z.number(),
  extractedData: z.object({
    challanNo: z.string(),
    date: z.string(),
    vehicle: z.string(),
    driver: z.string(),
    clientName: z.string(),
    projectName: z.string(),
    siteAddress: z.string(),
    poNumber: z.string(),
    remarks: z.string(),
    totalValue: z.number(),
    items: z.array(challanItemZ),
  }),
  validation: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type AiChallanResult = z.infer<typeof aiChallanResultSchema>;

export const CHALLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["documentType", "confidence", "extractedData", "validation", "warnings"],
  properties: {
    documentType: { type: "string", enum: [...DOCUMENT_TYPES] },
    confidence: { type: "number", description: "0.0-1.0 overall confidence." },
    validation: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
    extractedData: {
      type: "object",
      additionalProperties: false,
      required: [
        "challanNo",
        "date",
        "vehicle",
        "driver",
        "clientName",
        "projectName",
        "siteAddress",
        "poNumber",
        "remarks",
        "totalValue",
        "items",
      ],
      properties: {
        challanNo: { type: "string", description: "Challan number exactly as printed. Empty string if absent." },
        date: { type: "string", description: "Challan date as YYYY-MM-DD. Empty string if absent." },
        vehicle: { type: "string", description: "Vehicle number. Empty string if absent." },
        driver: { type: "string", description: "Driver name/contact. Empty string if absent." },
        clientName: { type: "string", description: "Who the goods were delivered to. Empty string if absent." },
        projectName: { type: "string", description: "Project name/reference printed on the challan. Empty string if absent." },
        siteAddress: { type: "string", description: "Delivery site. Empty string if absent." },
        poNumber: { type: "string", description: "'Against PO' reference. Empty string if absent." },
        remarks: { type: "string", description: "Remarks line. Empty string if absent." },
        totalValue: { type: "number", description: "Challan value in rupees if printed, else 0." },
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["description", "unit", "qty", "code", "remarks", "confidence"],
            properties: {
              description: { type: "string", description: "Goods description, max 15 words." },
              unit: { type: "string", description: "Unit of measure. Use 'Nos' when absent." },
              qty: { type: "number", description: "Quantity delivered, plain number." },
              code: { type: "string", description: "Item/HSN code if printed, else empty string." },
              remarks: { type: "string", description: "Row remark if present, else empty string." },
              confidence: { type: "number", description: "0.0-1.0 confidence for this row." },
            },
          },
        },
      },
    },
  },
} as const;

// ------------------------------------------------------------- classify

export const aiClassificationSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  confidence: z.number(),
  reason: z.string(),
});
export type AiClassification = z.infer<typeof aiClassificationSchema>;

export const CLASSIFY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["documentType", "confidence", "reason"],
  properties: {
    documentType: { type: "string", enum: [...DOCUMENT_TYPES] },
    confidence: { type: "number", description: "0.0-1.0 confidence in the classification." },
    reason: { type: "string", description: "One short sentence citing the evidence used." },
  },
} as const;
