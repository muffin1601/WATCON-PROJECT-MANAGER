import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { prisma } from "./prisma";
import { getSettings } from "./settings";

/**
 * Authorisation for deleting an entire project.
 *
 * This module is the whole security boundary for that action, and it lives
 * server-side only. Three properties matter:
 *
 *  - **No plaintext at rest.** Only a scrypt hash is stored. The existing
 *    `Setting.appPassword` (a soft, client-visible gate for editing challans)
 *    is deliberately NOT reused as-is: it reaches the browser, so treating it
 *    as a credential would mean the password for irreversible deletion is
 *    readable in the page source.
 *  - **Nothing reaches the client.** No route ever selects
 *    `deletePasswordHash`, and the verification result is a boolean — the
 *    browser learns only "accepted" or "rejected".
 *  - **The API verifies independently.** Hiding the button proves nothing;
 *    `DELETE /api/projects/[id]` calls verifyDeletePassword() itself, so a
 *    hand-rolled curl request is refused exactly like a UI request with the
 *    wrong password.
 *
 * Where the password comes from, in order:
 *  1. `PROJECT_DELETE_PASSWORD` in the environment — the recommended setup,
 *     because it never touches the database at all.
 *  2. `Setting.deletePasswordHash`, set through the Settings screen.
 *  3. The legacy `Setting.appPassword`, as a bootstrap so an existing
 *     deployment is not locked out of the new feature before an administrator
 *     has configured anything. Using it is logged.
 */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number
) => Promise<Buffer>;

const KEY_LENGTH = 64;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(plain, salt, KEY_LENGTH);
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

async function matchesHash(plain: string, stored: string): Promise<boolean> {
  const [scheme, salt, digest] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !digest) return false;
  const derived = await scryptAsync(plain, salt, KEY_LENGTH);
  const expected = Buffer.from(digest, "hex");
  // Length must be checked separately: timingSafeEqual throws on a mismatch
  // rather than returning false.
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}

/** Constant-time comparison of two plaintext strings of any length. */
function matchesPlain(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export class DeleteAuthorisationError extends Error {}

/**
 * Verifies a submitted password. Returns a boolean and nothing else — no
 * indication of which source matched, and no echo of the value submitted.
 *
 * Throws only when no password has been configured anywhere, which is a
 * server misconfiguration rather than a failed attempt, and is reported as
 * such without naming the setting involved.
 */
export async function verifyDeletePassword(submitted: unknown): Promise<boolean> {
  if (typeof submitted !== "string" || submitted.length === 0) return false;
  // Bound the work an unauthenticated caller can force us to do.
  if (submitted.length > 200) return false;

  const fromEnv = process.env.PROJECT_DELETE_PASSWORD;
  if (fromEnv) return matchesPlain(submitted, fromEnv);

  const settings = await getSettings();
  if (settings.deletePasswordHash) return matchesHash(submitted, settings.deletePasswordHash);

  if (settings.appPassword) {
    const ok = matchesPlain(submitted, settings.appPassword);
    if (ok) {
      console.warn(
        "[security] Project deletion was authorised with the legacy app password. Set PROJECT_DELETE_PASSWORD, or a deletion password in Settings, to use a hash that never reaches the browser."
      );
    }
    return ok;
  }

  throw new DeleteAuthorisationError("No deletion password is configured. Set one before deleting a project.");
}

/** Stores a new deletion password as a hash. The plaintext is discarded. */
export async function setDeletePassword(plain: string): Promise<void> {
  const settings = await getSettings();
  await prisma.setting.update({
    where: { id: settings.id },
    data: { deletePasswordHash: await hashPassword(plain) },
  });
}
