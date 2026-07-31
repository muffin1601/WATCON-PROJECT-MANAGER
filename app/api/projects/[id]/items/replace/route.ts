import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { z } from "zod";
import { poItemInputSchema } from "../../../../../../modules/projects/schema";
import { replaceProjectItems } from "../../../../../../services/projectService";
import { apiErrorResponse } from "../../../../../../lib/apiErrors";

interface Params {
  params: Promise<{ id: string }>;
}

const bodySchema = z.object({ items: z.array(poItemInputSchema) });

// Atomically replaces the whole Sales Order — used by the OCR "apply"
// review flow (see services/projectService.ts#replaceProjectItems for why
// this needs to be one transaction rather than N separate calls).
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body = await req.json();
    const { items } = bodySchema.parse(body);
    const result = await replaceProjectItems(id, items);
    return NextResponse.json({ items: result });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    return apiErrorResponse(err, "Project not found", "Failed to replace sales order items");
  }
}
