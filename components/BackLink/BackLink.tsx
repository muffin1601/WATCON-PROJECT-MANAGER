import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import styles from "./BackLink.module.css";

// Ported from .back — the "← Back to projects" link used above every sub-page.
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={styles.back}>
      <ChevronLeft size={16} />
      {children}
    </Link>
  );
}
