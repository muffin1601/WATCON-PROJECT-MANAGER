import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "./lib/sessionCookie";

// Blanket authentication gate for the API.
//
// Individual routes still perform their own permission checks (see
// requirePermission in lib/auth.ts) — this only guarantees that an
// unauthenticated request never reaches a route handler at all, so a missed
// check in one route cannot silently expose data to the public internet.
//
// It deliberately checks only that a session cookie is PRESENT. Verifying it
// needs the database, which is the route handlers' job; treating presence as
// proof of identity here would be wrong, and nothing downstream does.
export const config = {
  matcher: ["/api/:path*"],
};

// Public by design:
//  - /api/auth/*  : sign-in and sign-out must work before a session exists.
//  - /api/cron/*  : machine-invoked, guarded by BACKUP_CRON_SECRET instead.
const PUBLIC_PREFIXES = ["/api/auth/", "/api/cron/"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  if (!req.cookies.get(SESSION_COOKIE)?.value) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  return NextResponse.next();
}
