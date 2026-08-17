import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { getSettings } from "./settings";
import { can, type ActionKey, type ModuleKey, type PermissionMap } from "../modules/auth/permissions";
import { SESSION_COOKIE } from "./sessionCookie";

export { SESSION_COOKIE };

// Sign-in, sessions and server-side authorisation.
//
// The prototype kept users (with plaintext passwords) in localStorage and let
// the browser decide what it could do. That cannot survive on a real server, so
// the same UX is backed by:
//   - scrypt password hashes; the plaintext is never stored or logged
//   - an opaque random session token in an httpOnly cookie, of which only a
//     SHA-256 hash is stored, so database read access does not grant login
//   - requirePermission() called inside every mutating route, so hiding a
//     button in the UI is a convenience, never the control itself

const scryptAsync = promisify(scrypt) as (password: string, salt: string, keylen: number) => Promise<Buffer>;
const KEY_LENGTH = 64;

const SESSION_DAYS = 30;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(plain, salt, KEY_LENGTH);
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

async function passwordMatches(plain: string, stored: string): Promise<boolean> {
  const [scheme, salt, digest] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !digest) return false;
  const derived = await scryptAsync(plain, salt, KEY_LENGTH);
  const expected = Buffer.from(digest, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export interface SessionUser {
  id: string;
  name: string;
  username: string;
  role: "ADMIN" | "USER";
  perms: PermissionMap;
}

// Creates the default administrator the first time the app is used, matching
// the prototype's built-in "admin" account. The password comes from the
// existing Settings value so an existing deployment keeps the credential its
// staff already know, and it is stored only as a hash.
export async function ensureBootstrapAdmin(): Promise<void> {
  const count = await prisma.user.count();
  if (count > 0) return;
  const settings = await getSettings();
  await prisma.user.create({
    data: {
      name: "Administrator",
      username: "admin",
      normUsername: "admin",
      passwordHash: await hashPassword(settings.appPassword || "pincode110020"),
      role: "ADMIN",
      active: true,
    },
  });
}

export class AuthError extends Error {}

/** Verifies credentials and issues a session. Returns the raw cookie token. */
export async function signIn(username: string, password: string): Promise<{ token: string; user: SessionUser }> {
  await ensureBootstrapAdmin();
  const user = await prisma.user.findUnique({ where: { normUsername: username.trim().toLowerCase() } });

  // One message for every failure mode (unknown user, wrong password,
  // deactivated) so the form cannot be used to enumerate valid usernames.
  const reject = () => {
    throw new AuthError("Incorrect username or password, or the user is inactive.");
  };
  if (!user || !user.active) {
    // Still spend the hashing time when the user does not exist, so response
    // timing does not reveal which usernames are real.
    await passwordMatches(password, `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`);
    reject();
  }
  if (!(await passwordMatches(password, user!.passwordHash))) reject();

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { tokenHash: tokenHash(token), userId: user!.id, expiresAt } });

  return {
    token,
    user: {
      id: user!.id,
      name: user!.name,
      username: user!.username,
      role: user!.role,
      perms: (user!.perms as PermissionMap) ?? {},
    },
  };
}

export async function signOut(token: string | undefined): Promise<void> {
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
}

/** Resolves the signed-in user from the session cookie, or null. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date() || !session.user.active) return null;

  return {
    id: session.user.id,
    name: session.user.name,
    username: session.user.username,
    role: session.user.role,
    perms: (session.user.perms as PermissionMap) ?? {},
  };
}

export function setSessionCookie(res: NextResponse, token: string): NextResponse {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Secure in production only, so local http development still works.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return res;
}

export function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}

export class ForbiddenError extends Error {}
export class UnauthenticatedError extends Error {}

/**
 * The authorisation check every API route runs before mutating anything.
 * Throws rather than returning a boolean so a route cannot accidentally
 * continue after a failed check.
 */
export async function requirePermission(mod: ModuleKey, act: ActionKey): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError("Please sign in.");
  if (!can(user, mod, act)) {
    throw new ForbiddenError(`You do not have permission to ${act} in this module.`);
  }
  return user;
}

/** Read-side equivalent: any signed-in user with view rights on the module. */
export async function requireView(mod: ModuleKey): Promise<SessionUser> {
  return requirePermission(mod, "view");
}

/**
 * Authentication only, for endpoints that aren't scoped to one module (global
 * search, which already filters what it returns by what exists).
 */
export async function requireAuth(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError("Please sign in.");
  return user;
}

/** Maps auth failures onto HTTP responses. Call from route catch blocks. */
export function authErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof UnauthenticatedError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  return null;
}

/** Removes expired sessions. Cheap enough to run opportunistically on sign-in. */
export async function pruneExpiredSessions(): Promise<void> {
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
