import Link from "next/link";
import { GlobalSearch } from "./GlobalSearch";
import { LogoutButton } from "./LogoutButton";
import { can } from "../../modules/auth/permissions";
import type { SessionUser } from "../../lib/auth";
import styles from "./Header.module.css";

// Ported from <header class="app"> plus applyNavPerms(): brand, permission-
// filtered nav, user chip, Logout, waterline gradient bar.
export function Header({ user }: { user: SessionUser | null }) {
  return (
    <header className={styles.app}>
      <div className={styles.bar}>
        <Link href="/" className={styles.brand}>
          <b>WATCON</b>
          <span>Project Management</span>
        </Link>
        {user && <GlobalSearch />}
        <nav className={styles.top}>
          {can(user, "projects", "view") && <Link href="/">Projects</Link>}
          {can(user, "quotes", "view") && <Link href="/quotations">Quotations</Link>}
          {can(user, "customers", "view") && <Link href="/customers">Customers</Link>}
          {can(user, "purchase", "view") && <Link href="/purchase">Purchase</Link>}
          {can(user, "items", "view") && <Link href="/stocks">Items &amp; Stocks</Link>}
          {can(user, "settings", "view") && <Link href="/settings">Settings</Link>}
          {user?.role === "ADMIN" && <Link href="/admin">Admin</Link>}
          {can(user, "projects", "create") && (
            <Link href="/projects/new" className={styles.primary}>
              + New Project
            </Link>
          )}
          {user && (
            <span className={styles.userChip}>
              {user.name}
              {user.role === "ADMIN" ? " · admin" : ""}
            </span>
          )}
          {user && <LogoutButton />}
        </nav>
      </div>
      <div className={styles.waterline} />
    </header>
  );
}
