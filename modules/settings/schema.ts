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
  quotePrefix: z.string().min(1),
  // The next number to be issued. Editing it moves the counter; the actual
  // allocation is still done atomically at create time
  // (services/quotationService.ts allocateRef), so this is a starting point,
  // not a value any request depends on reading first.
  quoteNext: z.coerce.number().int().min(1),
  appPassword: z.string().min(4, "Password must be at least 4 characters"),
  // Write-only, like deletePassword below: the stored key is never sent to the
  // browser, so the field always renders blank and an empty value means "keep
  // the current key". Sending the literal "__CLEAR__" removes it.
  anthropicApiKey: z.string().trim().max(200).optional().default(""),
  // Full-project deletion password. Write-only: the form always renders it
  // blank and an empty value means "leave the current one alone", because the
  // stored hash cannot (and must not) be sent back to the browser to
  // pre-fill a field.
  deletePassword: z
    .string()
    .refine((v) => v === "" || v.length >= 8, "Deletion password must be at least 8 characters")
    .optional()
    .default(""),
});
export type SettingsInput = z.infer<typeof settingsInputSchema>;
