import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { projectInputSchema } from "../../../modules/projects/schema";
import { createProject } from "../../../services/projectService";
import { requirePermission } from "../../../lib/auth";

export async function POST(req: NextRequest) {
  try {
    await requirePermission("projects", "create");
    const body = await req.json();
    const input = projectInputSchema.parse(body);
    const project = await createProject(input);
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}
