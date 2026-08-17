import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { userInputSchema } from "../../../modules/auth/schema";
import { createUser, listUsers, UserConflictError, UserValidationError } from "../../../services/userService";
import { authErrorResponse, ForbiddenError, getCurrentUser, UnauthenticatedError } from "../../../lib/auth";

// User administration is admin-only — not a per-module permission, matching the
// prototype where the Admin nav item appears for role === admin alone.
async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError("Please sign in.");
  if (user.role !== "ADMIN") throw new ForbiddenError("Only an administrator can manage users.");
  return user;
}

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ users: await listUsers() });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error(err);
    return NextResponse.json({ error: "Failed to load users" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const input = userInputSchema.parse(await req.json());
    return NextResponse.json({ user: await createUser(input) }, { status: 201 });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    if (err instanceof UserConflictError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof UserValidationError) return NextResponse.json({ error: err.message }, { status: 422 });
    console.error(err);
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}
