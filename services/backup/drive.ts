import { Readable } from "node:stream";
import { google } from "googleapis";

/**
 * Google Drive upload for the weekly backup.
 *
 * Authenticates as a **service account**: a non-human identity whose
 * credentials do not expire and need no interactive consent, which is what an
 * unattended weekly job requires. An OAuth refresh token would work until the
 * day it is revoked or expires, and would then fail silently — exactly the
 * failure mode a backup must not have.
 *
 * Setup (see AI_DOCUMENT_ENGINE.md):
 *   1. Create a service account in Google Cloud and enable the Drive API.
 *   2. Download its JSON key.
 *   3. Share the destination Drive folder with the service account's email,
 *      granting Editor.
 *   4. Set GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_DRIVE_FOLDER_ID.
 *
 * Step 3 is the one people miss: a service account has its own empty Drive,
 * so without an explicit share the upload succeeds into a folder nobody can
 * see.
 */

export class DriveNotConfiguredError extends Error {}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

function credentials(): ServiceAccountKey {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new DriveNotConfiguredError(
      "GOOGLE_SERVICE_ACCOUNT_JSON is not set — off-site backup upload is disabled."
    );
  }

  let parsed: ServiceAccountKey;
  try {
    // Accept both raw JSON and base64, because multi-line private keys are
    // routinely mangled by dashboards that do not preserve newlines.
    const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    parsed = JSON.parse(text) as ServiceAccountKey;
  } catch {
    throw new DriveNotConfiguredError(
      "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON (or base64-encoded JSON)."
    );
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new DriveNotConfiguredError(
      "GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key."
    );
  }

  return {
    client_email: parsed.client_email,
    // Env vars commonly carry the key with literal "\n" rather than newlines.
    private_key: parsed.private_key.replace(/\\n/g, "\n"),
  };
}

export function isDriveConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_DRIVE_FOLDER_ID);
}

export interface DriveUploadResult {
  fileId: string;
  fileName: string;
  webViewLink: string | null;
}

export async function uploadToDrive(
  fileName: string,
  contents: Buffer,
  mimeType = "application/gzip"
): Promise<DriveUploadResult> {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) {
    throw new DriveNotConfiguredError("GOOGLE_DRIVE_FOLDER_ID is not set.");
  }

  const key = credentials();
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    // drive.file is the narrowest scope that works: it grants access only to
    // files this service account creates, not to the whole Drive.
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });

  const drive = google.drive({ version: "v3", auth });

  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: Readable.from(contents) },
    fields: "id, name, webViewLink",
  });

  if (!res.data.id) throw new Error("Google Drive did not return a file id for the upload.");

  return {
    fileId: res.data.id,
    fileName: res.data.name ?? fileName,
    webViewLink: res.data.webViewLink ?? null,
  };
}

/**
 * Lists backups previously uploaded by this service account, newest first.
 *
 * Deliberately read-only and never used to delete: the spec says "keep
 * previous backups", and an automated pruner is exactly the kind of code that
 * quietly removes the one copy you needed.
 */
export async function listBackups(limit = 20): Promise<{ id: string; name: string; createdTime: string }[]> {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) throw new DriveNotConfiguredError("GOOGLE_DRIVE_FOLDER_ID is not set.");

  const key = credentials();
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });

  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    orderBy: "createdTime desc",
    pageSize: limit,
    fields: "files(id, name, createdTime)",
  });

  return (res.data.files ?? []).map((f) => ({
    id: f.id ?? "",
    name: f.name ?? "",
    createdTime: f.createdTime ?? "",
  }));
}
