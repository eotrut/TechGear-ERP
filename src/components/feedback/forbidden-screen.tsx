import { ShieldAlert } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * The 403 screen, shared by two paths that both need it:
 *
 *  - `app/forbidden.tsx`, rendered when a page or server component calls
 *    `forbidden()` after a failed requirePermission check
 *  - `app/(auth)/forbidden/page.tsx`, the route middleware rewrites to when it
 *    blocks navigation before the page is ever reached
 */
export function ForbiddenScreen({ permission }: { permission?: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <span className="mb-4 inline-flex size-10 items-center justify-center rounded-md border border-hairline bg-surface-2 text-warning">
          <ShieldAlert className="size-5" aria-hidden />
        </span>
        <h1 className="text-title text-ink">You do not have access to this page</h1>
        <p className="mt-2 text-body-sm text-ink-subtle">
          Your role does not include this permission. If you think that is wrong, ask an
          administrator to review your access.
        </p>
        {permission ? (
          <p className="mt-3 font-mono text-[12px] text-ink-subtle">Missing: {permission}</p>
        ) : null}
        <div className="mt-6 flex justify-center gap-2">
          <Button asChild variant="primary">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
