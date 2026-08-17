import { z } from "zod";

export const QUOTATION_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CONVERTED"] as const;
export const CHARGE_MODES = ["INCLUDED", "EXTRA"] as const;
export const INSTALL_BASES = ["PERCENT", "LUMPSUM", "PER_UNIT"] as const;

export const QUOTATION_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  CONVERTED: "Converted",
};

// CONVERTED is set only by the convert-to-project action, never chosen by
// hand — converting is what makes it true, and un-setting it would orphan the
// created project.
export const SELECTABLE_QUOTATION_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"] as const;

export const quotationItemSchema = z.object({
  catalogItemId: z.string().uuid().optional().nullable().default(null),
  section: z.string().trim().max(120).optional().default(""),
  description: z.string().trim().min(1, "Item description is required").max(500),
  makes: z.array(z.string().trim().min(1).max(120)).max(50).optional().default([]),
  unit: z.string().trim().min(1).max(20).optional().default("Nos"),
  qty: z.coerce.number().min(0, "Qty must be 0 or more"),
  rate: z.coerce.number().min(0, "Rate must be 0 or more"),
  discPct: z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((v) => {
      if (v === undefined || v === null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    })
    .refine((v) => v === null || (v >= 0 && v <= 100), "Discount must be between 0 and 100"),
});
export type QuotationItemInput = z.infer<typeof quotationItemSchema>;

export const quotationInputSchema = z.object({
  customerId: z.string().uuid().optional().nullable().default(null),
  // Required so a quotation always prints a client, even if no customer row
  // is linked yet; the service links or creates one from this name.
  client: z.string().trim().min(1, "Customer is required").max(200),
  title: z.string().trim().min(1, "Project title is required").max(300),
  date: z.string().min(1, "Date is required"),
  billing: z.string().trim().max(1000).optional().default(""),
  delivery: z.string().trim().max(1000).optional().default(""),
  refBy: z.string().trim().max(200).optional().default(""),
  salesPerson: z.string().trim().max(200).optional().default(""),
  status: z.enum(SELECTABLE_QUOTATION_STATUSES).optional().default("DRAFT"),
  validityDays: z.coerce.number().int().min(0).max(3650).optional().default(30),

  discountPct: z.coerce.number().min(0).max(100).optional().default(0),

  installMode: z.enum(CHARGE_MODES).optional().default("INCLUDED"),
  installBasis: z.enum(INSTALL_BASES).optional().default("PERCENT"),
  installValue: z.coerce.number().min(0).optional().default(0),

  transportMode: z.enum(CHARGE_MODES).optional().default("INCLUDED"),
  transportAmount: z.coerce.number().min(0).optional().default(0),

  gstMode: z.enum(CHARGE_MODES).optional().default("EXTRA"),
  gstPct: z.coerce.number().min(0).max(100).optional().default(18),

  roundTo: z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((v) => {
      if (v === undefined || v === null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    }),

  note: z.string().trim().max(2000).optional().default(""),
  terms: z.string().trim().max(20000).optional().default(""),
  showDetails: z.coerce.boolean().optional().default(false),
  areaTotalsWithGst: z.coerce.boolean().optional().default(false),
  sections: z.array(z.string().trim().max(120)).max(100).optional().default([]),

  items: z.array(quotationItemSchema).max(1000).optional().default([]),
});
export type QuotationInput = z.infer<typeof quotationInputSchema>;

export const quotationUpdateSchema = quotationInputSchema.partial();
export type QuotationUpdateInput = z.infer<typeof quotationUpdateSchema>;

export const quotationListQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  status: z.enum(QUOTATION_STATUSES).optional(),
  customerId: z.string().uuid().optional(),
  from: z.string().optional().default(""),
  to: z.string().optional().default(""),
  includeArchived: z
    .union([z.boolean(), z.string()])
    .optional()
    .default(false)
    .transform((v) => v === true || v === "true" || v === "1"),
  sort: z.enum(["date", "value", "ref"]).optional().default("date"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type QuotationListQuery = z.infer<typeof quotationListQuerySchema>;

// Default terms text, carried over verbatim from the business's standard
// quotation so a new quote starts from the wording they already use.
export const QUOTE_DEFAULT_TERMS = `1. WARRANTY: All our plants come with a warranty of 1 year from the date of installation or 18 months from the date of supply, whichever is earlier.
2. VALIDITY: Our offer remains valid for a period of thirty days from the date of issue of this proposal.
3. COMPLETION PERIOD: We offer to complete the entire job within a period of 12-16 weeks from the date of receipt of your order.
4. TERMS OF PAYMENT FOR SUPPLY: 50% advance with order, 40% against PI before supply & 10% on installation.
5. TERMS OF PAYMENT FOR INSTALLATION: 80% on installation, 10% against commissioning, 10% on handover.
6. EXCLUSIONS: Drainage system; electrical connection and electricity for welding; water for testing; any item not mentioned in scope of supply; any civil / excavation works.
7. STORAGE: Storage for safe custody of equipment, and receiving / unloading / shifting of material at site, is in client scope.
8. GST & TRANSPORTATION: Extra as actual.`;
