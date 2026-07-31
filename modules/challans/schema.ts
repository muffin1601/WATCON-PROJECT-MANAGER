import { z } from "zod";

// Ported from challanModal()/attachChallanModal() in the prototype.

export const challanItemInputSchema = z.object({
  itemId: z.string().min(1),
  qty: z.coerce.number().min(0),
  extraQty: z.coerce.number().min(0).default(0),
});
export type ChallanItemInput = z.infer<typeof challanItemInputSchema>;

export const challanExtraItemInputSchema = z.object({
  description: z.string().min(1),
  unit: z.string().min(1).default("Nos"),
  qty: z.coerce.number().positive(),
  rate: z.coerce.number().min(0).default(0),
});
export type ChallanExtraItemInput = z.infer<typeof challanExtraItemInputSchema>;

// "Issue new challan" — dispatch against the Sales Order, source ISSUED_HERE.
// Challan number is auto-assigned server-side from settings.challanPrefix/Next.
export const issueChallanInputSchema = z.object({
  date: z.string().min(1),
  vehicle: z.string().optional().default(""),
  driver: z.string().optional().default(""),
  remarks: z.string().optional().default(""),
  items: z.array(challanItemInputSchema).default([]),
  extraItems: z.array(challanExtraItemInputSchema).default([]),
});
export type IssueChallanInput = z.infer<typeof issueChallanInputSchema>;

// "Attach Zoho challan" — records a challan issued outside this system,
// source ATTACHED_EXTERNAL. No balance-qty enforcement (already dispatched).
export const attachChallanInputSchema = z.object({
  no: z.string().min(1, "Challan number is required"),
  date: z.string().min(1),
  manualValue: z.coerce.number().min(0).optional(),
  items: z.array(z.object({ itemId: z.string().min(1), qty: z.coerce.number().min(0) })).default([]),
});
export type AttachChallanInput = z.infer<typeof attachChallanInputSchema>;

export const generateBillInputSchema = z.object({
  uptoDate: z.string().min(1),
  applyDiscount: z.boolean().default(true),
});
export type GenerateBillInput = z.infer<typeof generateBillInputSchema>;
