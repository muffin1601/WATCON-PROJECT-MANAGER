import { ReactNode } from "react";
import styles from "./Chip.module.css";

export type ChipTone = "teal" | "gold" | "green" | "red" | "grey";

// Ported from .chip .teal/.gold/.green/.red/.grey
export function Chip({ tone = "grey", children }: { tone?: ChipTone; children: ReactNode }) {
  return <span className={[styles.chip, styles[tone]].join(" ")}>{children}</span>;
}
