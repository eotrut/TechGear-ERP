import { FileQuestion } from "lucide-react";
import Link from "next/link";

import { StatusScreen } from "@/components/feedback/status-screen";
import { Button } from "@/components/ui/button";

/** A URL that matches no route at all. Records that vanished get the in-shell 404. */
export default function NotFound() {
  return (
    <StatusScreen
      icon={FileQuestion}
      title="Page not found"
      description="That page does not exist, or it may have been moved."
      actions={
        <Button asChild variant="primary">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      }
    />
  );
}
