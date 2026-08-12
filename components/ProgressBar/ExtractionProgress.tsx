import { Check } from "lucide-react";
import type { ExtractionJobState } from "../../hooks/useExtractionJob";
import { ProgressBar } from "./ProgressBar";
import styles from "./ExtractionProgress.module.css";

const STEPS = [
  { stage: "UPLOADING", label: "Upload" },
  { stage: "READING", label: "Read" },
  { stage: "OCR", label: "Scan text" },
  { stage: "EXTRACTING", label: "Extract" },
  { stage: "VALIDATING", label: "Check" },
  { stage: "GENERATING", label: "Prepare" },
  { stage: "COMPLETED", label: "Done" },
] as const;

export function ExtractionProgress({ job }: { job: ExtractionJobState }) {
  const stageIndex = STEPS.findIndex((step) => step.stage === job.stage);
  const activeIndex = stageIndex >= 0 ? stageIndex : 0;
  const isChunked = job.totalChunks > 0;

  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <div className={styles.summary}>
        <strong>{job.stageLabel}</strong>
        <span>
          {job.pageCount > 0 ? `${job.pageCount} page(s)` : job.fileName}
          {isChunked ? ` - part ${job.chunksDone + 1} of ${job.totalChunks}` : ""}
        </span>
      </div>
      <ProgressBar percent={job.progressPct} />
      <ol className={styles.steps} aria-label="Document processing steps">
        {STEPS.map((step, index) => {
          const state = index < activeIndex ? "done" : index === activeIndex ? "active" : "pending";
          return (
            <li key={step.stage} className={styles[state]}>
              <span className={styles.dot}>{state === "done" ? <Check size={11} /> : index + 1}</span>
              <span>{step.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
