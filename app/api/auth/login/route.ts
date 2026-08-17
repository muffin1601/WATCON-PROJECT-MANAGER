import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { AuthError, pruneExpiredSessions, setSessionCookie, signIn } from "../../../../lib/auth";

const loginSchema = z.object({
  username: z.string().trim().min(1, "Username is required").max(100),
  password: z.string().min(1, "Password is required").max(200),
});

export async function POST(req: NextRequest) {
  try {
    const { username, password } = loginSchema.parse(await req.json());
    const { token, user } = await signIn(username, password);
    // Opportunistic housekeeping; a failure here must not fail the sign-in.
    void pruneExpiredSessions().catch(() => {});
    return setSessionCookie(NextResponse.json({ user }), token);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Enter a username and password." }, { status: 400 });
    }
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error(err);
    return NextResponse.json({ error: "Could not sign in. Please try again." }, { status: 500 });
  }
}
