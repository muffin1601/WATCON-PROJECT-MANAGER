import { ReactNode } from "react";
import styles from "./Status.module.css";

// Ported from .spin (loading spinner) and .ai-badge (AI-drafted indicator)
export function Spinner() {
  return <span className={styles.spin} aria-hidden />;
}

export function AiBadge({ children }: { children: ReactNode }) {
  return <span className={styles.aiBadge}>{children}</span>;
}
