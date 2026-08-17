import type { Metadata } from "next";
import "../styles/tokens.css";
import "../styles/globals.css";
import { Header } from "../components/Header/Header";
import { LoginForm } from "../components/Auth/LoginForm";
import { ToastProvider } from "../components/Toast/ToastProvider";
import { QueryProvider } from "../components/QueryProvider/QueryProvider";
import { getCurrentUser } from "../lib/auth";
import layout from "../styles/layout.module.css";

export const metadata: Metadata = {
  title: "Watcon Project Management",
  description: "Watcon internal project, challan, billing and payment tracker",
};

// Every page renders behind sign-in. When there is no session the layout swaps
// the whole application for the login card and renders no navigation at all —
// the same thing renderLogin() does in the prototype. This is a convenience
// gate only: each API route re-checks the session and the caller's permissions
// itself, so a direct request cannot bypass it.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <html lang="en">
      {/* suppressHydrationWarning: browser extensions (password managers,
          BitDefender etc.) inject attributes like bis_register/__processed_*
          into <body> before React hydrates — a mismatch the app can't
          prevent. Suppression only applies to THIS element's attributes,
          not children, so real hydration bugs still surface. */}
      <body suppressHydrationWarning>
        <QueryProvider>
          <ToastProvider>
            <Header user={user} />
            <main className={layout.main}>{user ? children : <LoginForm />}</main>
          </ToastProvider>
        </QueryProvider>
        <div id="printArea" />
      </body>
    </html>
  );
}
