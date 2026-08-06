import { CSSProperties, ReactNode } from "react";
import styles from "./FormField.module.css";

// Ported from label.f > span.t (the label wrapper used throughout every form in the prototype)
export function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.f}>
      <span className={styles.t}>{label}</span>
      {children}
    </label>
  );
}

// Ported from .frow { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)) }
export function FormRow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className={styles.frow} style={style}>
      {children}
    </div>
  );
}
