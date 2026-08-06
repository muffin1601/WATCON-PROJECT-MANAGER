import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { transportInputSchema } from "../../../../../modules/projects/schema";
import { addTransport } from "../../../../../services/transportService";
import { apiErrorResponse } from "../../../../../lib/apiErrors";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const input = transportInputSchema.parse(await req.json());
    const transport = await addTransport(id, input);
    return NextResponse.json({ transport }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    return apiErrorResponse(err, "Project not found", "Failed to add transport bill");
  }
}
