import { ReactNode } from "react";
import styles from "./Chip.module.css";

export type ChipTone = "teal" | "gold" | "green" | "red" | "grey";

// Ported from .chip .teal/.gold/.green/.red/.grey
export function Chip({ tone = "grey", title, children }: { tone?: ChipTone; title?: string; children: ReactNode }) {
  return <span className={[styles.chip, styles[tone]].join(" ")} title={title}>{children}</span>;
}
