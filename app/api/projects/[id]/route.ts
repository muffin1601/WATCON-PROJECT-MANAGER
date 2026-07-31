import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { projectUpdateSchema } from "../../../../modules/projects/schema";
import { deleteProject, updateProject } from "../../../../services/projectService";
import { apiErrorResponse } from "../../../../lib/apiErrors";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body = await req.json();
    const input = projectUpdateSchema.parse(body);
    const project = await updateProject(id, input);
    return NextResponse.json({ project });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    return apiErrorResponse(err, "Project not found", "Failed to update project");
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await deleteProject(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err, "Project not found", "Failed to delete project");
  }
}
