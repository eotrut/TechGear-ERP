"use client";

import { useEffect } from "react";

import "./globals.css";

/**
 * The last resort, for a failure in the root layout itself. It replaces the
 * whole document, so it cannot use the theme provider or any component that
 * assumes one; it is plain markup on the light ladder.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en-PH">
      <body className="bg-canvas font-sans text-ink">
        <main className="flex min-h-dvh items-center justify-center px-4">
          <div className="w-full max-w-md text-center">
            <h1 className="text-title text-ink">TechGear ERP could not start</h1>
            <p className="mt-2 text-body-sm text-ink-subtle">
              Something failed before the app could load. Try again in a moment.
            </p>
            {error.digest ? (
              <p className="mt-3 font-mono text-[12px] text-ink-subtle">
                Reference: {error.digest}
              </p>
            ) : null}
            <button
              type="button"
              onClick={reset}
              className="mt-6 h-8 rounded-md bg-accent-fill px-3.5 text-body font-medium text-accent-on-fill"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
