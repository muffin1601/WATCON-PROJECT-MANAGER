"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./Header.module.css";

// Ported from the prototype's Logout nav button. Styled as a nav link so it
// sits in the same row without introducing a new button style.
export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      // Refresh regardless: if the request failed the cookie may still be
      // valid, and the reload shows the true state rather than a false
      // "signed out" screen.
      router.replace("/");
      router.refresh();
      setBusy(false);
    }
  };

  return (
    <button type="button" className={styles.navButton} onClick={logout} disabled={busy}>
      {busy ? "…" : "Logout"}
    </button>
  );
}
