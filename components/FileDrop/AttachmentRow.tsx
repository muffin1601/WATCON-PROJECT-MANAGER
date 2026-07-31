import { FileText } from "lucide-react";
import { Button } from "../Button/Button";
import styles from "./AttachmentRow.module.css";

export interface AttachmentRowProps {
  name: string;
  addedDate: string;
  onView: () => void;
  onRemove?: () => void;
}

// Ported from attRow(a, onDel) — .att row with name/date/view/remove.
export function AttachmentRow({ name, addedDate, onView, onRemove }: AttachmentRowProps) {
  return (
    <div className={styles.att}>
      <span className={styles.nm}>
        <FileText size={14} style={{ display: "inline", marginRight: 4, verticalAlign: -2 }} />
        {name}
      </span>
      <span className={styles.mt}>{addedDate}</span>
      <Button size="sm" onClick={onView}>
        View / Download
      </Button>
      {onRemove && (
        <Button size="sm" variant="danger" onClick={onRemove}>
          Remove
        </Button>
      )}
    </div>
  );
}
