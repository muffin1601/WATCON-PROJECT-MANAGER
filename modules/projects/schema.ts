import { z } from "zod";

// Mirrors the fields captured in renderNew()/challanModal() etc. in the
// prototype. Keep option lists identical to the HTML <select>/.seg options.

export const PROJECT_TYPES = [
  "SWIMMING_POOL",
  "WATER_BODY_FOUNTAIN",
  "TILES_SUPPLY",
  "TILES_SUPPLY_INSTALL",
  "FIREPLACE",
  "SAUNA_STEAM_SPA",
  "MIXED_SCOPE",
] as const;

export const PROJECT_STATUSES = ["IN_PROGRESS", "ON_HOLD", "COMPLETED"] as const;

export const APPROVAL_MODES = [
  "PURCHASE_ORDER",
  "QUOTE_EMAIL",
  "QUOTE_WHATSAPP",
  "QUOTE_VERBAL",
] as const;

export const TERMS_GST = ["INCLUDED", "EXTRA"] as const;
export const TERMS_TRANSPORT = ["INCLUDED", "EXTRA"] as const;

export const poItemInputSchema = z.object({
  description: z.string().min(1, "Description is required"),
  make: z.string().optional().default(""),
  unit: z.string().min(1, "Unit is required").default("Nos"),
  qty: z.coerce.number().min(0, "Qty must be 0 or more"),
  rate: z.coerce.number().min(0, "Rate must be 0 or more"),
  orderId: z.string().optional().nullable().default(null),
});
export type PoItemInput = z.infer<typeof poItemInputSchema>;

// ---- Transport bills (prototype's transportModal / challan transport section) ----
export const transportInputSchema = z.object({
  date: z.string().min(1, "Date is required"),
  amount: z.coerce.number().positive("Enter the transport bill amount"),
  transporter: z.string().optional().default(""),
  ref: z.string().optional().default(""),
  vehicle: z.string().optional().default(""),
  challanId: z.string().optional().nullable().default(null),
});
export type TransportInput = z.infer<typeof transportInputSchema>;

export const transportUpdateSchema = transportInputSchema.partial();
export type TransportUpdateInput = z.infer<typeof transportUpdateSchema>;

// ---- Additional orders (prototype's addOrderModal) ----
export const projectOrderInputSchema = z.object({
  ref: z.string().min(1, "Order reference is required"),
  date: z.string().optional().default(""),
  // Optional AI/manually parsed items to create under this order
  items: z.array(poItemInputSchema.omit({ orderId: true })).default([]),
});
export type ProjectOrderInput = z.infer<typeof projectOrderInputSchema>;

// ---- Split item (prototype's splitItemModal) ----
export const splitItemInputSchema = z.object({
  subs: z
    .array(
      z.object({
        description: z.string().min(1, "Description is required"),
        unit: z.string().min(1).default("Nos"),
        qty: z.coerce.number().positive("Qty must be greater than 0"),
        rate: z.coerce.number().min(0),
      })
    )
    .min(2, "Enter at least 2 sub-items"),
});
export type SplitItemInput = z.infer<typeof splitItemInputSchema>;

// ---- Amend sales order (prototype's amendSOModal) ----
export const amendSalesOrderInputSchema = z.object({
  note: z.string().min(1, "Amendment note is required"),
  date: z.string().min(1, "Date is required"),
  items: z
    .array(
      z.object({
        id: z.string().optional().nullable().default(null), // existing item id, null = new
        description: z.string().min(1),
        make: z.string().optional().default(""),
        unit: z.string().min(1).default("Nos"),
        qty: z.coerce.number().min(0),
        rate: z.coerce.number().min(0),
        orderId: z.string().optional().nullable().default(null),
      })
    )
    .default([]),
});
export type AmendSalesOrderInput = z.infer<typeof amendSalesOrderInputSchema>;

// ---- Items & Stocks ----
export const itemMasterInputSchema = z.object({
  name: z.string().min(1, "Item name is required"),
  make: z.string().optional().default(""),
  unit: z.string().optional().default("Nos"),
});
export type ItemMasterInput = z.infer<typeof itemMasterInputSchema>;

export const stockEntryInputSchema = z.object({
  date: z.string().min(1, "Date is required"),
  qty: z.coerce.number().refine((v) => v !== 0, "Enter quantity"),
  note: z.string().optional().default(""),
});
export type StockEntryInput = z.infer<typeof stockEntryInputSchema>;

export const projectInputSchema = z.object({
  name: z.string().min(1, "Project name is required"),
  client: z.string().min(1, "Client name is required"),
  site: z.string().optional().default(""),
  type: z.enum(PROJECT_TYPES),
  status: z.enum(PROJECT_STATUSES).default("IN_PROGRESS"),
  approvalMode: z.enum(APPROVAL_MODES).default("PURCHASE_ORDER"),
  approvalBasisNote: z.string().optional().default(""),
  poNumber: z.string().optional().default(""),
  poDate: z.string().optional().default(""),
  termsGst: z.enum(TERMS_GST).default("EXTRA"),
  termsTransport: z.enum(TERMS_TRANSPORT).default("EXTRA"),
  paymentTerms: z.string().optional().default(""),
  items: z.array(poItemInputSchema).default([]),
});
export type ProjectInput = z.infer<typeof projectInputSchema>;

export const projectUpdateSchema = projectInputSchema.omit({ items: true }).partial();
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;

export const paymentInputSchema = z.object({
  date: z.string().min(1, "Date is required"),
  amount: z.coerce.number().positive("Enter an amount greater than 0"),
  mode: z.enum(["BANK_TRANSFER", "CHEQUE", "UPI", "CASH", "ADJUSTMENT"]),
  reference: z.string().optional().default(""),
});
export type PaymentInput = z.infer<typeof paymentInputSchema>;
