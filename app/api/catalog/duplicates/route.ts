import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { CatalogValidationError, duplicateGroups, mergeDuplicateNames } from "../../../../services/catalogService";
import { apiErrorResponse } from "../../../../lib/apiErrors";
import { requirePermission } from "../../../../lib/auth";

const mergeSchema = z.object({
  keep: z.string().trim().min(1, "Choose the name to keep"),
  merge: z.array(z.string().trim().min(1)).min(1, "Nothing to merge"),
});

export async function GET() {
  try {
    await requirePermission("items", "view");
    return NextResponse.json({ groups: await duplicateGroups() });
  } catch (err) {
    return apiErrorResponse(err, "Not found", "Failed to check for duplicates");
  }
}

// Merging rewrites names across sales orders, quotations and stock, so it is
// an "amend" on the items module rather than a create.
export async function POST(req: NextRequest) {
  try {
    await requirePermission("items", "amend");
    const { keep, merge } = mergeSchema.parse(await req.json());
    const result = await mergeDuplicateNames(keep, merge);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    if (err instanceof CatalogValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return apiErrorResponse(err, "Not found", "Failed to merge the item names");
  }
}
