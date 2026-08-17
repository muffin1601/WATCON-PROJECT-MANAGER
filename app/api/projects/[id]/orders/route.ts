import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { projectOrderInputSchema } from "../../../../../modules/projects/schema";
import { addProjectOrder } from "../../../../../services/projectService";
import { apiErrorResponse } from "../../../../../lib/apiErrors";
import { requirePermission } from "../../../../../lib/auth";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await requirePermission("salesorder", "create");
    const input = projectOrderInputSchema.parse(await req.json());
    const order = await addProjectOrder(id, input);
    return NextResponse.json({ order }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    return apiErrorResponse(err, "Project not found", "Failed to add order");
  }
}
