import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { userUpdateSchema } from "../../../../modules/auth/schema";
import { deleteUser, updateUser, UserConflictError, UserValidationError } from "../../../../services/userService";
import { authErrorResponse, ForbiddenError, getCurrentUser, UnauthenticatedError } from "../../../../lib/auth";

type Ctx = { params: Promise<{ userId: string }> };

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError("Please sign in.");
  if (user.role !== "ADMIN") throw new ForbiddenError("Only an administrator can manage users.");
  return user;
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin();
    const { userId } = await params;
    const input = userUpdateSchema.parse(await req.json());
    return NextResponse.json({ user: await updateUser(userId, input) });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    if (err instanceof UserConflictError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof UserValidationError) return NextResponse.json({ error: err.message }, { status: 422 });
    console.error(err);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const current = await requireAdmin();
    const { userId } = await params;
    await deleteUser(userId, current.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    if (err instanceof UserValidationError) return NextResponse.json({ error: err.message }, { status: 409 });
    console.error(err);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
