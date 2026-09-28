"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCw, TriangleAlert } from "lucide-react";

import { StatusScreen } from "@/components/feedback/status-screen";
import { Button } from "@/components/ui/button";

/**
 * What an error boundary renders. It says what happened in plain words,
 * offers a retry (most failures here are a database hiccup that a second try
 * clears), and shows Next's digest so a report can be matched to the server
 * log. The message itself is never shown: in production it is redacted, and
 * in development it would leak a stack trace into a screenshot.
 */
export function ErrorScreen({
  error,
  reset,
  inShell = true,
  home = "/dashboard",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  inShell?: boolean;
  home?: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StatusScreen
      inShell={inShell}
      icon={TriangleAlert}
      tone="danger"
      title="This page could not load"
      description="Something went wrong on our side while loading it. Nothing you entered was lost; try again, and if it keeps happening, send the reference below to an administrator."
      detail={error.digest ? `Reference: ${error.digest}` : undefined}
      actions={
        <>
          <Button variant="primary" onClick={reset}>
            <RotateCw aria-hidden />
            Try again
          </Button>
          <Button asChild variant="secondary">
            <Link href={home}>Back to dashboard</Link>
          </Button>
        </>
      }
    />
  );
}
