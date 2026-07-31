import { ReactNode } from "react";
import styles from "./StatsGrid.module.css";

// Ported from .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)) }
export function StatsGrid({ children }: { children: ReactNode }) {
  return <div className={styles.stats}>{children}</div>;
}
