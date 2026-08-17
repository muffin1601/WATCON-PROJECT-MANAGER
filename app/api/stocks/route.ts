import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { itemMasterInputSchema } from "../../../modules/projects/schema";
import { createItemMaster, listItemsWithStats, StockValidationError } from "../../../services/stockService";
import { apiErrorResponse } from "../../../lib/apiErrors";
import { requirePermission } from "../../../lib/auth";

export async function GET() {
  try {
    await requirePermission("items", "view");
    const items = await listItemsWithStats();
    return NextResponse.json({ items });
  } catch (err) {
    return apiErrorResponse(err, "Not found", "Failed to load items & stocks");
  }
}

export async function POST(req: NextRequest) {
  try {
    await requirePermission("items", "create");
    const input = itemMasterInputSchema.parse(await req.json());
    const item = await createItemMaster(input);
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    if (err instanceof StockValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return apiErrorResponse(err, "Not found", "Failed to add item", "This item + make already exists");
  }
}
