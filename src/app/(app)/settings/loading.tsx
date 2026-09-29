import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";

/** The settings index's own shape: a short list of linked sections. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[860px]" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <PageHeader title="Settings" />
      <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline">
        {Array.from({ length: 5 }).map((_, index) => (
          <li key={index} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-4 shrink-0" />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3.5 w-2/3" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
