import { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import styles from "./Table.module.css";

// Ported from table.tbl (+ .tbl-wrap scroll container, .r alignment, tfoot totals)
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className={styles.wrap}>{children}</div>;
}

export function Table({ children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <table className={styles.tbl} {...rest}>
      {children}
    </table>
  );
}

// Omit the native (deprecated) `align` DOM attribute before intersecting our
// own — without this, TdHTMLAttributes's `align?: "left"|"center"|...` and
// our `align?: "r"` intersect to `never`, which TS then reports as a
// confusing "string is not assignable to undefined" on every usage.
type Align = { align?: "r" };

export function Th({ align, className, ...rest }: Omit<ThHTMLAttributes<HTMLTableCellElement>, "align"> & Align) {
  return <th className={[align === "r" ? styles.r : "", className].filter(Boolean).join(" ")} {...rest} />;
}

export function Td({ align, className, ...rest }: Omit<TdHTMLAttributes<HTMLTableCellElement>, "align"> & Align) {
  return <td className={[align === "r" ? styles.r : "", className].filter(Boolean).join(" ")} {...rest} />;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className={styles.empty}>{children}</div>;
}
