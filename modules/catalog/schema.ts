import { z } from "zod";

// Item Sheet (product catalogue) validation. Prices are optional because a
// product is often added to the sheet before its commercials are known.

const money = z
  .union([z.number(), z.string()])
  .optional()
  .nullable()
  .transform((v) => {
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  })
  .refine((v) => v === null || v >= 0, "Must be 0 or more");

const percent = z
  .union([z.number(), z.string()])
  .optional()
  .nullable()
  .transform((v) => {
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  })
  .refine((v) => v === null || (v >= 0 && v <= 100), "Must be between 0 and 100");

export const catalogComponentSchema = z.object({
  name: z.string().trim().min(1, "Part name is required").max(200),
  make: z.string().trim().max(120).optional().default(""),
  unit: z.string().trim().min(1).max(20).optional().default("Nos"),
  qty: z.coerce.number().positive("Qty per unit must be greater than 0"),
});
export type CatalogComponentInput = z.infer<typeof catalogComponentSchema>;

export const catalogItemInputSchema = z.object({
  name: z.string().trim().min(1, "Item name is required").max(300),
  unit: z.string().trim().min(1, "Unit is required").max(20).default("Nos"),
  category: z.string().trim().max(120).optional().default(""),
  hsn: z.string().trim().max(20).optional().default(""),
  details: z.string().trim().max(5000).optional().default(""),
  makes: z.array(z.string().trim().min(1).max(120)).max(50).optional().default([]),
  sellPrice: money,
  discountPct: percent,
  purchasePrice: money,
  purchaseDiscPct: percent,
  components: z.array(catalogComponentSchema).max(100).optional().default([]),
});
export type CatalogItemInput = z.infer<typeof catalogItemInputSchema>;

export const catalogItemUpdateSchema = catalogItemInputSchema.partial();
export type CatalogItemUpdateInput = z.infer<typeof catalogItemUpdateSchema>;

export const catalogListQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  category: z.string().trim().max(120).optional().default(""),
  includeArchived: z
    .union([z.boolean(), z.string()])
    .optional()
    .default(false)
    .transform((v) => v === true || v === "true" || v === "1"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
});
export type CatalogListQuery = z.infer<typeof catalogListQuerySchema>;
