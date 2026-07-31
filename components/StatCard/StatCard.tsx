import styles from "./StatCard.module.css";

export interface StatCardProps {
  label: string;
  value: string;
  highlight?: boolean;
  tone?: "pos" | "neg";
}

// Ported from .stat / .stat.hl / .val.pos / .val.neg
export function StatCard({ label, value, highlight, tone }: StatCardProps) {
  const cardClass = [styles.stat, highlight ? styles.hl : ""].filter(Boolean).join(" ");
  const valClass = [styles.val, tone === "pos" ? styles.pos : "", tone === "neg" ? styles.neg : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cardClass}>
      <div className={styles.lbl}>{label}</div>
      <div className={valClass}>{value}</div>
    </div>
  );
}
