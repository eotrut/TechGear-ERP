import { FileQuestion } from "lucide-react";
import Link from "next/link";

import { StatusScreen } from "@/components/feedback/status-screen";
import { Button } from "@/components/ui/button";

/**
 * A record that does not exist, or no longer does: a mistyped id, an archived
 * product, a link from an old notification. Rendered inside the shell, so the
 * sidebar and the palette are still right there.
 */
export default function RecordNotFound() {
  return (
    <StatusScreen
      inShell
      icon={FileQuestion}
      title="We could not find that record"
      description="It may have been archived, or the link may be wrong. Search for it instead, or head back."
      actions={
        <Button asChild variant="primary">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      }
    />
  );
}
