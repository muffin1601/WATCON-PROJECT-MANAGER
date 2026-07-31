"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useState } from "react";

// One QueryClient per browser session (not per render) — standard App Router pattern.
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000 } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
