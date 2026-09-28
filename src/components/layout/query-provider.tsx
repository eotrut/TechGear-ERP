"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * TanStack Query, for the few reads that genuinely happen in the browser: the
 * notification bell, which polls, and the command palette, which searches as
 * you type. Everything else is a server component reading on the server.
 *
 * One client per mount, not per module, so two signed-in sessions rendered by
 * the same server never share a cache.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
