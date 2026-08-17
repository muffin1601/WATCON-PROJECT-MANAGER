import { z } from "zod";

// Validation for the Purchase module — suppliers, rate inquiries, supplier
// replies and purchase orders. Field lists follow the prototype's
// vendorFormModal / rfqVendorsStep / manualReplyModal / renderPo exactly.

export const vendorInputSchema = z.object({
  name: z.string().trim().min(1, "Supplier name is required").max(200),
  contact: z.string().trim().max(200).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  email: z.string().trim().max(200).optional().default(""),
  gstin: z.string().trim().toUpperCase().max(20).optional().default(""),
  address: z.string().trim().max(1000).optional().default(""),
});
export type VendorInput = z.infer<typeof vendorInputSchema>;

export const vendorUpdateSchema = vendorInputSchema.partial();
export type VendorUpdateInput = z.infer<typeof vendorUpdateSchema>;

// ---- Rate inquiry ----

export const rfqLineInputSchema = z.object({
  name: z.string().trim().min(1).max(300),
  make: z.string().trim().max(120).optional().default(""),
  unit: z.string().trim().min(1).max(20).optional().default("Nos"),
  category: z.string().trim().max(120).optional().default(""),
  required: z.coerce.number().min(0).default(0),
  stock: z.coerce.number().default(0),
  qty: z.coerce.number().positive("Quantity to order must be greater than 0"),
  projectNames: z.array(z.string().trim().max(300)).max(200).optional().default([]),
});
export type RfqLineInput = z.infer<typeof rfqLineInputSchema>;

export const rfqInputSchema = z.object({
  date: z.string().min(1, "Inquiry date is required"),
  due: z.string().optional().default(""),
  deliverTo: z.string().trim().max(1000).optional().default(""),
  note: z.string().trim().max(4000).optional().default(""),
  projectIds: z.array(z.string().uuid()).min(1, "Select at least one project"),
  lines: z.array(rfqLineInputSchema).min(1, "Select at least one item with a to-order quantity"),
  vendorIds: z.array(z.string().uuid()).min(1, "Select at least one supplier"),
});
export type RfqInput = z.infer<typeof rfqInputSchema>;

// A supplier's reply. `rate: null` means "cannot supply", which is different
// from quoting zero — the comparison sheet shows it as "not quoted".
export const rfqOfferInputSchema = z.object({
  lineId: z.string().uuid(),
  rate: z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .transform((v) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }),
  gst: z.coerce.number().min(0).max(100).optional().default(0),
  remark: z.string().trim().max(500).optional().default(""),
});

export const rfqResponseInputSchema = z.object({
  vendorId: z.string().uuid(),
  quotedBy: z.string().trim().max(200).optional().default(""),
  contact: z.string().trim().max(200).optional().default(""),
  ref: z.string().trim().max(200).optional().default(""),
  validity: z.coerce.number().int().min(0).max(3650).optional().nullable().default(null),
  transport: z.coerce.number().min(0).optional().default(0),
  transportGst: z.coerce.number().min(0).max(100).optional().default(0),
  transportNote: z.string().trim().max(500).optional().default(""),
  delivery: z.string().trim().max(500).optional().default(""),
  payment: z.string().trim().max(500).optional().default(""),
  remarks: z.string().trim().max(2000).optional().default(""),
  manual: z.coerce.boolean().optional().default(false),
  filledAt: z.string().optional().default(""),
  items: z.array(rfqOfferInputSchema).max(2000).default([]),
});
export type RfqResponseInput = z.infer<typeof rfqResponseInputSchema>;

// The file a supplier's reply form downloads. Validated before anything is
// stored, so a hand-edited or wrong-inquiry file is rejected with a message
// rather than silently corrupting the comparison.
export const rfqReplyFileSchema = z.object({
  rfqId: z.string().optional(),
  rfqNo: z.string().optional(),
  vendorId: z.string().optional(),
  vendor: z.string().optional(),
  quotedBy: z.string().optional(),
  contact: z.string().optional(),
  ref: z.string().optional(),
  validity: z.union([z.number(), z.string()]).optional(),
  transport: z.union([z.number(), z.string()]).optional(),
  transportNote: z.string().optional(),
  transportGst: z.union([z.number(), z.string()]).optional(),
  delivery: z.string().optional(),
  payment: z.string().optional(),
  remarks: z.string().optional(),
  filledAt: z.string().optional(),
  items: z
    .array(
      z.object({
        id: z.string(),
        rate: z.union([z.number(), z.string(), z.null()]).optional(),
        gst: z.union([z.number(), z.string()]).optional(),
        remark: z.string().optional(),
      })
    )
    .default([]),
});
export type RfqReplyFile = z.infer<typeof rfqReplyFileSchema>;

/** Per-line supplier choice made on the comparison sheet. */
export const rfqSelectionSchema = z.object({
  lineId: z.string().uuid(),
  vendorId: z.string().uuid().nullable(),
});

export const PO_STATUSES = ["ISSUED", "PARTIALLY_RECEIVED", "COMPLETED", "CANCELLED"] as const;

// Prototype labels for the PO status dropdown.
export const PO_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  PARTIALLY_RECEIVED: "Partly received",
  COMPLETED: "Received",
  CANCELLED: "Cancelled",
};

export const poUpdateSchema = z.object({
  status: z.enum(PO_STATUSES).optional(),
  transport: z.coerce.number().min(0).optional(),
  transportGst: z.coerce.number().min(0).max(100).optional(),
  delivery: z.string().trim().max(500).optional(),
  payment: z.string().trim().max(500).optional(),
  deliverTo: z.string().trim().max(1000).optional(),
  remarks: z.string().trim().max(4000).optional(),
  lines: z
    .array(
      z.object({
        id: z.string().uuid(),
        qty: z.coerce.number().min(0).optional(),
        rate: z.coerce.number().min(0).optional(),
        gst: z.coerce.number().min(0).max(100).optional(),
      })
    )
    .max(2000)
    .optional(),
});
export type PoUpdateInput = z.infer<typeof poUpdateSchema>;

export const poReceiptSchema = z.object({
  lineId: z.string().uuid(),
  // The TOTAL received to date for that line, not an increment — the service
  // posts only the difference, so re-saving the same number is a no-op.
  receivedQty: z.coerce.number().min(0),
});
export type PoReceiptInput = z.infer<typeof poReceiptSchema>;
