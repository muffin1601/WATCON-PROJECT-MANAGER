import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "../../../../../lib/prisma";
import { poItemInputSchema } from "../../../../../modules/projects/schema";
import { addProjectItem } from "../../../../../services/projectService";
import { apiErrorResponse } from "../../../../../lib/apiErrors";
import { requirePermission } from "../../../../../lib/auth";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await requirePermission("salesorder", "create");
    const body = await req.json();
    const input = poItemInputSchema.parse(body);
    const count = await prisma.poItem.count({ where: { projectId: id } });
    const item = await addProjectItem(id, input, count);
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    return apiErrorResponse(err, "Project not found", "Failed to add item");
  }
}
