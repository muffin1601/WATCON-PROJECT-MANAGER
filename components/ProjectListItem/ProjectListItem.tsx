import Link from "next/link";
import { Card } from "../Card/Card";
import { Chip } from "../Chip/Chip";
import { ProgressBar } from "../ProgressBar/ProgressBar";
import { inr } from "../../lib/format";
import { PROJECT_STATUS_LABEL, PROJECT_TYPE_LABEL } from "../../modules/projects/data";
import styles from "./ProjectListItem.module.css";

export interface ProjectListItemProps {
  id: string;
  name: string;
  client: string;
  site: string | null;
  type: string;
  status: string;
  contractValue: number;
  dispatchedValue: number;
  paidTotal: number;
}

const statusTone: Record<string, "green" | "gold" | "grey"> = {
  COMPLETED: "green",
  ON_HOLD: "gold",
  IN_PROGRESS: "grey",
};

// Ported from .pitem — project card in the dashboard list, with the same
// contract/dispatch progress bar and received-amount summary.
export function ProjectListItem(p: ProjectListItemProps) {
  const pct = p.contractValue > 0 ? Math.min(100, (p.dispatchedValue / p.contractValue) * 100) : 0;
  return (
    <Card as={Link} href={`/projects/${p.id}`} className={styles.pitem}>
      <div>
        <h4>{p.name}</h4>
        <div className={styles.sub}>
          {p.client} · {p.site || ""} <Chip tone="teal">{PROJECT_TYPE_LABEL[p.type] ?? p.type}</Chip>{" "}
          <Chip tone={statusTone[p.status] ?? "grey"}>{PROJECT_STATUS_LABEL[p.status] ?? p.status}</Chip>
        </div>
      </div>
      <div className={styles.nums}>
        Contract <span className="money">{inr(p.contractValue)}</span>
        <br />
        Sent <span className="money">{inr(p.dispatchedValue)}</span> · Received{" "}
        <span className="money" style={{ color: "var(--ok)" }}>
          {inr(p.paidTotal)}
        </span>
      </div>
      <ProgressBar percent={pct} />
    </Card>
  );
}
