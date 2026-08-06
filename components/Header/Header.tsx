import Link from "next/link";
import { GlobalSearch } from "./GlobalSearch";
import styles from "./Header.module.css";

// Ported from <header class="app"> — brand, top nav, waterline gradient bar.
// GlobalSearch is additive (see its own file for the rationale) — same dark
// header visual language, no change to the prototype's existing elements.
export function Header() {
  return (
    <header className={styles.app}>
      <div className={styles.bar}>
        <Link href="/" className={styles.brand}>
          <b>WATCON</b>
          <span>Project Management</span>
        </Link>
        <GlobalSearch />
        <nav className={styles.top}>
          <Link href="/">Projects</Link>
          <Link href="/stocks">Items &amp; Stocks</Link>
          <Link href="/settings">Settings</Link>
          <Link href="/projects/new" className={styles.primary}>
            + New Project
          </Link>
        </nav>
      </div>
      <div className={styles.waterline} />
    </header>
  );
}
