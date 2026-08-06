"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drives one AI extraction: uploads the file, then polls the job row until it
 * reaches a terminal state, exposing stage + percent for the progress bar.
 *
 * Polling (rather than holding a streaming response open) is what lets a
 * 50-page extraction survive the user navigating away and back — the job
 * lives in the database, not in this component.
 */

export type ExtractionKind = "order" | "challan" | "classify";

export interface ExtractionJobState {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  stage: string;
  stageLabel: string;
  progressPct: number;
  fileName: string;
  pageCount: number;
  detectedType: string | null;
  errorMessage: string | null;
  result: unknown;
}

export type ExtractionPhase =
  | { status: "idle" }
  | { status: "running"; job: ExtractionJobState }
  | { status: "done"; job: ExtractionJobState }
  | { status: "failed"; message: string };

const POLL_INTERVAL_MS = 1500;

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error || fallback;
  }

  const text = await res.text().catch(() => "");
  if (text.trim()) {
    return `${fallback} Server returned ${res.status} ${res.statusText || ""}.`;
  }
  return fallback;
}

export function useExtractionJob() {
  const [phase, setPhase] = useState<ExtractionPhase>({ status: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelled = useRef(false);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // Guard against setState after unmount: a 50-page extraction easily
  // outlives the modal that started it.
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      stop();
    };
  }, [stop]);

  const reset = useCallback(() => {
    stop();
    setPhase({ status: "idle" });
  }, [stop]);

  /** Polls until terminal, then settles exactly once with the job or null. */
  const poll = useCallback((jobId: string, settle: (job: ExtractionJobState | null) => void) => {
    const tick = async () => {
      if (cancelled.current) {
        settle(null);
        return;
      }
      try {
        const res = await fetch(`/api/ai/jobs/${jobId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(await readErrorMessage(res, "Lost track of this extraction."));
        const data = await res.json().catch(() => ({}));

        const job = data.job as ExtractionJobState;
        if (cancelled.current) {
          settle(null);
          return;
        }

        if (job.status === "SUCCEEDED") {
          setPhase({ status: "done", job });
          settle(job);
          return;
        }
        if (job.status === "FAILED") {
          setPhase({ status: "failed", message: job.errorMessage || "Reading this document failed." });
          settle(null);
          return;
        }

        setPhase({ status: "running", job });
        timer.current = setTimeout(tick, POLL_INTERVAL_MS);
      } catch (err) {
        if (!cancelled.current) {
          setPhase({
            status: "failed",
            message: err instanceof Error ? err.message : "Lost track of this extraction.",
          });
        }
        settle(null);
      }
    };
    void tick();
  }, []);

  /**
   * Uploads and runs to completion. Resolves with the finished job, or null
   * if it failed — the failure message is already in `phase`, so callers that
   * only need to render it can ignore the return value.
   */
  const start = useCallback(
    async (
      file: File,
      kind: ExtractionKind,
      opts: { projectId?: string; documentId?: string } = {}
    ): Promise<ExtractionJobState | null> => {
      stop();
      setPhase({
        status: "running",
        job: {
          id: "",
          status: "QUEUED",
          stage: "UPLOADING",
          stageLabel: "Uploading",
          progressPct: 5,
          fileName: file.name,
          pageCount: 0,
          detectedType: null,
          errorMessage: null,
          result: null,
        },
      });

      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("kind", kind);
        if (opts.projectId) fd.append("projectId", opts.projectId);
        if (opts.documentId) fd.append("documentId", opts.documentId);

        const res = await fetch("/api/ai/extract", { method: "POST", body: fd });
        if (!res.ok) throw new Error(await readErrorMessage(res, "Could not start reading this document."));
        const data = await res.json().catch(() => ({}));

        return await new Promise<ExtractionJobState | null>((resolve) => {
          poll(data.jobId as string, resolve);
        });
      } catch (err) {
        if (!cancelled.current) {
          setPhase({
            status: "failed",
            message: err instanceof Error ? err.message : "Could not start reading this document.",
          });
        }
        return null;
      }
    },
    [poll, stop]
  );

  return { phase, start, reset };
}
