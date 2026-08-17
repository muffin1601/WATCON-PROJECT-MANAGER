import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearSessionCookie, SESSION_COOKIE, signOut } from "../../../../lib/auth";

export async function POST() {
  // The session row is deleted, not just the cookie — otherwise a copied
  // cookie would keep working after the user believed they had signed out.
  const store = await cookies();
  await signOut(store.get(SESSION_COOKIE)?.value);
  return clearSessionCookie(NextResponse.json({ ok: true }));
}
