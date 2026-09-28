"use client";

import { ErrorScreen } from "@/components/feedback/error-screen";

/** The register keeps its slim bar, so "Orders" is still one tap away. */
export default function PosError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorScreen error={error} reset={reset} home="/orders" />;
}
