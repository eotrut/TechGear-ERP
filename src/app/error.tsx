"use client";

import { ErrorScreen } from "@/components/feedback/error-screen";

/** Everything outside the shell: sign in, printed documents. */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorScreen error={error} reset={reset} inShell={false} />;
}
