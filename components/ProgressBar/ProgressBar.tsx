import styles from "./ProgressBar.module.css";

// Ported from .bar-track / .bar-fill (project dispatch progress on the project list)
export function ProgressBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className={styles.track}>
      <div className={styles.fill} style={{ width: `${clamped}%` }} />
    </div>
  );
}
