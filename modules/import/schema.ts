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
      })
    )
    .default([]),
});
export type ExtractedOrder = z.infer<typeof extractedOrderSchema>;

export const EMPTY_EXTRACTED_ORDER: ExtractedOrder = {
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
