import type { Metadata } from "next";
import "../styles/tokens.css";
import "../styles/globals.css";
import { Header } from "../components/Header/Header";
import { ToastProvider } from "../components/Toast/ToastProvider";
import { QueryProvider } from "../components/QueryProvider/QueryProvider";
import layout from "../styles/layout.module.css";

export const metadata: Metadata = {
  title: "Watcon Project Management",
  description: "Watcon internal project, challan, billing and payment tracker",
};

// No authentication in this app: every route is public, opens straight to
// the Dashboard, mirroring the source HTML prototype.
export default function RootLayout({ children }: { children: React.ReactNode }) {
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
            <Header />
            <main className={layout.main}>{children}</main>
          </ToastProvider>
        </QueryProvider>
        <div id="printArea" />
      </body>
    </html>
  );
}
