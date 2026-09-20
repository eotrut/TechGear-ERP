import { FileQuestion } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <span className="mb-4 inline-flex size-10 items-center justify-center rounded-md border border-hairline bg-surface-2 text-ink-subtle">
          <FileQuestion className="size-5" aria-hidden />
        </span>
        <h1 className="text-title text-ink">Page not found</h1>
        <p className="mt-2 text-body-sm text-ink-subtle">
          That page does not exist, or it may have been moved.
        </p>
        <div className="mt-6 flex justify-center">
          <Button asChild variant="primary">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
