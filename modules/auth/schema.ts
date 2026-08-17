import { z } from "zod";

export const USER_ROLES = ["ADMIN", "USER"] as const;

export const userInputSchema = z.object({
  name: z.string().trim().min(1, "Full name is required").max(200),
  username: z
    .string()
    .trim()
    .min(1, "Username is required")
    .max(100)
    .regex(/^[A-Za-z0-9._@-]+$/, "Use letters, numbers, dot, dash, underscore or @ only"),
  password: z.string().min(6, "Password must be at least 6 characters").max(200),
  role: z.enum(USER_ROLES).default("USER"),
  active: z.coerce.boolean().default(true),
  // Shape is validated by sanitizePerms() in the service, which drops anything
  // that isn't a known module/action.
  perms: z.record(z.string(), z.record(z.string(), z.boolean())).optional().default({}),
});
export type UserInput = z.infer<typeof userInputSchema>;

export const userUpdateSchema = userInputSchema
  .partial()
  // Blank means "leave the password alone", so it must be allowed through
  // where the create schema demands a minimum length.
  .extend({ password: z.string().max(200).optional() });
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
