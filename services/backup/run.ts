import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { BackupStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { exportAllData } from "../settingsService";
import { uploadToDrive, isDriveConfigured, DriveNotConfiguredError } from "./drive";

/**
 * Weekly off-site backup: export -> compress -> timestamp -> upload to Drive.
 *
 * The database itself is untouched — this reads through the same
 * `exportAllData()` the Settings page's manual export already uses, so the
 * two can never drift apart in what they consider a complete backup.
 *
 * Every attempt writes a BackupRun row, successful or not. A backup that
 * fails quietly is worse than no backup, because it is trusted right up until
 * the moment it is needed.
 */

export interface BackupOutcome {
  runId: string;
  status: BackupStatus;
  fileName?: string;
  sizeBytes?: number;
  remoteFileId?: string;
  error?: string;
}

/** watcon-pm-backup-2026-08-05T11-30-00Z.json.gz */
function backupFileName(now: Date): string {
  return `watcon-pm-backup-${now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-")}.json.gz`;
}

export async function runBackup(options: { attempt?: number } = {}): Promise<BackupOutcome> {
  const attempt = options.attempt ?? 1;
  const run = await prisma.backupRun.create({
    data: { status: BackupStatus.RUNNING, attempts: attempt },
  });

  try {
    const data = await exportAllData();
    const json = JSON.stringify(data);

    // gzip: these exports are overwhelmingly repetitive JSON and compress by
    // roughly an order of magnitude, which matters once document metadata for
    // hundreds of challans is in there.
    const compressed = gzipSync(Buffer.from(json, "utf8"), { level: 9 });
    const checksum = createHash("sha256").update(compressed).digest("hex");
    const fileName = backupFileName(new Date());

    if (!isDriveConfigured()) {
      throw new DriveNotConfiguredError(
        "Google Drive backup is not configured (GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_DRIVE_FOLDER_ID)."
      );
    }

    const uploaded = await uploadToDrive(fileName, compressed);

    const completed = await prisma.backupRun.update({
      where: { id: run.id },
      data: {
        status: BackupStatus.SUCCEEDED,
        fileName: uploaded.fileName,
        sizeBytes: compressed.byteLength,
        remoteFileId: uploaded.fileId,
        projectCount: data.projects.length,
        checksum,
        completedAt: new Date(),
      },
    });

    return {
      runId: completed.id,
      status: BackupStatus.SUCCEEDED,
      fileName: uploaded.fileName,
      sizeBytes: compressed.byteLength,
      remoteFileId: uploaded.fileId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Backup failed";
    console.error("[backup] run failed", err);
    await prisma.backupRun.update({
      where: { id: run.id },
      data: { status: BackupStatus.FAILED, errorMessage: message, completedAt: new Date() },
    });
    return { runId: run.id, status: BackupStatus.FAILED, error: message };
  }
}

/**
 * Runs the backup, retrying transient failures with exponential backoff.
 *
 * Configuration errors are not retried: a missing service-account key will be
 * just as missing in thirty seconds, and burning three attempts on it only
 * delays the failure being reported.
 */
export async function runBackupWithRetry(maxAttempts = 3): Promise<BackupOutcome> {
  let last: BackupOutcome | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await runBackup({ attempt });
    if (last.status === BackupStatus.SUCCEEDED) return last;

    const misconfigured = last.error?.includes("not configured") || last.error?.includes("is not set");
    if (misconfigured) return last;

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
    }
  }

  return last!;
}

/**
 * True when the most recent successful backup is older than a week (or there
 * has never been one). Lets a trigger that fires more often than weekly stay
 * idempotent — running it daily still produces one backup per week.
 */
export async function isBackupDue(intervalDays = 7): Promise<boolean> {
  const lastSuccess = await prisma.backupRun.findFirst({
    where: { status: BackupStatus.SUCCEEDED },
    orderBy: { completedAt: "desc" },
    select: { completedAt: true },
  });
  if (!lastSuccess?.completedAt) return true;
  return Date.now() - lastSuccess.completedAt.getTime() >= intervalDays * 24 * 60 * 60 * 1000;
}
