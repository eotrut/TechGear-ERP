"use client";

import { ErrorScreen } from "@/components/feedback/error-screen";

/**
 * Catches a failed render anywhere under the shell. The sidebar and top bar
 * live in the layout above this boundary, so they survive and the person can
 * navigate away instead of facing a blank page.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorScreen error={error} reset={reset} />;
}
