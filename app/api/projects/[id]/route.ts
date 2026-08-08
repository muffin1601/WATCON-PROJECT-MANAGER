import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { projectUpdateSchema } from "../../../../modules/projects/schema";
import {
  deleteProjectCompletely,
  ProjectNotFoundError,
  updateProject,
} from "../../../../services/projectService";
import { removeStorageObjects } from "../../../../services/documentService";
import { verifyDeletePassword, DeleteAuthorisationError } from "../../../../lib/deletePassword";
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

/**
 * Deletes an entire project and everything belonging to it.
 *
 * The password is verified HERE, inside the request that performs the delete —
 * not in the browser, and not in a separate "check the password" endpoint that
 * a caller could simply skip. A direct API call without a password, or with
 * the wrong one, is refused with 401 and deletes nothing; the UI's
 * confirmation and password dialogs are convenience, never the control.
 *
 * The response deliberately never distinguishes "no password supplied" from
 * "wrong password", and never reveals whether a project with this id exists
 * until authorisation has succeeded — so this endpoint cannot be used to
 * enumerate project ids.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;

  let password: unknown;
  try {
    const body = await req.json();
    password = (body as { password?: unknown })?.password;
  } catch {
    // A DELETE with no body at all: treated exactly like a wrong password.
    password = undefined;
  }

  try {
    if (!(await verifyDeletePassword(password))) {
      return NextResponse.json(
        { error: "That password is not correct. The project has not been deleted." },
        { status: 401 }
      );
    }
  } catch (err) {
    if (err instanceof DeleteAuthorisationError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }

  try {
    const summary = await deleteProjectCompletely(id, removeStorageObjects);
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    if (err instanceof ProjectNotFoundError) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return apiErrorResponse(err, "Project not found", "Failed to delete project");
  }
}
