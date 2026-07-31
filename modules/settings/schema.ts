import { z } from "zod";

// Matches the exact fields in the prototype's renderSettings() — company
// profile, GST rate, challan/bill numbering. The prototype's "Anthropic API
// key" field doesn't carry over: that existed only because the prototype
// called the Anthropic API directly from the browser. OCR is now a
// server-side provider selected via OCR_PROVIDER/env, not a per-tenant
// DB-stored key — see KNOWN_LIMITATIONS.md.
export const settingsInputSchema = z.object({
  companyName: z.string().min(1, "Company name is required"),
  address: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().min(1),
  gstin: z.string().optional().default(""),
  gstRatePct: z.coerce.number().min(0).max(100),
  challanPrefix: z.string().min(1),
  challanNext: z.coerce.number().int().min(1),
  billPrefix: z.string().min(1),
  appPassword: z.string().min(4, "Password must be at least 4 characters"),
});
export type SettingsInput = z.infer<typeof settingsInputSchema>;
