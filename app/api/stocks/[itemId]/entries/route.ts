import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { stockEntryInputSchema } from "../../../../../modules/projects/schema";
import { addStockEntry } from "../../../../../services/stockService";
import { apiErrorResponse } from "../../../../../lib/apiErrors";
import { requirePermission } from "../../../../../lib/auth";

interface Params {
  params: Promise<{ itemId: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const { itemId } = await params;
  try {
    await requirePermission("items", "create");
    const input = stockEntryInputSchema.parse(await req.json());
    const entry = await addStockEntry(itemId, input);
    return NextResponse.json({ entry }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    return apiErrorResponse(err, "Item not found", "Failed to save stock entry");
  }
}
