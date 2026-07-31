import { z } from "zod";

// Ported from tabAdjust() — "Give special discount" and "Add amendment" modals.
export const discountInputSchema = z.object({
  date: z.string().min(1),
  amount: z.coerce.number().positive("Enter an amount greater than 0"),
  reason: z.string().optional().default(""),
});
export type DiscountInput = z.infer<typeof discountInputSchema>;

export const amendmentInputSchema = z.object({
  date: z.string().min(1),
  description: z.string().min(1, "Description is required"),
  valueChange: z.coerce.number().refine((v) => !Number.isNaN(v), "Value change is required"),
});
export type AmendmentInput = z.infer<typeof amendmentInputSchema>;
