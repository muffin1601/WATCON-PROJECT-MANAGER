import { z } from "zod";

// Validation for the Customers module. Applied on the server inside every
// route handler — the client form uses the same schema through
// @hookform/resolvers so the two can never disagree.

// Indian GSTIN: 2-digit state code, 10-char PAN, entity digit, 'Z', checksum.
// Optional everywhere — plenty of Watcon's customers are individuals.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

const optionalTrimmed = z
  .string()
  .trim()
  .max(500, "Too long")
  .optional()
  .default("");

export const customerInputSchema = z.object({
  name: z.string().trim().min(1, "Customer name is required").max(200, "Name is too long"),
  billing: z.string().trim().max(1000).optional().default(""),
  delivery: z.string().trim().max(1000).optional().default(""),
  phone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .default("")
    .refine((v) => v === "" || /^[0-9+()\-\s]{6,20}$/.test(v), "Enter a valid phone number"),
  email: z
    .string()
    .trim()
    .max(200)
    .optional()
    .default("")
    .refine((v) => v === "" || z.string().email().safeParse(v).success, "Enter a valid email address"),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .max(20)
    .optional()
    .default("")
    .refine((v) => v === "" || GSTIN_RE.test(v), "Enter a valid 15-character GSTIN"),
  refBy: optionalTrimmed,
  salesPerson: optionalTrimmed,
  notes: z.string().trim().max(5000).optional().default(""),
});
export type CustomerInput = z.infer<typeof customerInputSchema>;

export const customerUpdateSchema = customerInputSchema.partial();
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;

// Query params for the customer list — server-side search/sort/pagination so
// the browser never pulls the whole table.
export const customerListQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  includeArchived: z
    .union([z.boolean(), z.string()])
    .optional()
    .default(false)
    .transform((v) => v === true || v === "true" || v === "1"),
  sort: z.enum(["name", "due", "contract", "recent"]).optional().default("name"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;
