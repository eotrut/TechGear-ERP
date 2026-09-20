import { LogIn } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

/** 401. Rendered when `unauthorized()` is called without a valid session. */
export default function Unauthorized() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <span className="mb-4 inline-flex size-10 items-center justify-center rounded-md border border-hairline bg-surface-2 text-ink-subtle">
          <LogIn className="size-5" aria-hidden />
        </span>
        <h1 className="text-title text-ink">Your session has ended</h1>
        <p className="mt-2 text-body-sm text-ink-subtle">
          Sign in again to continue where you left off.
        </p>
        <div className="mt-6 flex justify-center">
          <Button asChild variant="primary">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
