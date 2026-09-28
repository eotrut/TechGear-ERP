import { ShieldAlert } from "lucide-react";
import Link from "next/link";

import { StatusScreen } from "@/components/feedback/status-screen";
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
    <StatusScreen
      icon={ShieldAlert}
      tone="warning"
      title="You do not have access to this page"
      description="Your role does not include this permission. If you think that is wrong, ask an administrator to review your access."
      detail={permission ? `Missing: ${permission}` : undefined}
      actions={
        <Button asChild variant="primary">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      }
    />
  );
}
