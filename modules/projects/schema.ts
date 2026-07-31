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
  unit: z.string().min(1, "Unit is required").default("Nos"),
  qty: z.coerce.number().min(0, "Qty must be 0 or more"),
  rate: z.coerce.number().min(0, "Rate must be 0 or more"),
});
export type PoItemInput = z.infer<typeof poItemInputSchema>;

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
