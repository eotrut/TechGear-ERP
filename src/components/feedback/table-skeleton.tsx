import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading state for a resource list.
 *
 * It mirrors the real table: the same header strip, the same row height, the
 * same column count. A generic spinner would move the layout twice, once to
 * show itself and once to show the data.
 */
export function TableSkeleton({
  columns = 6,
  rows = 8,
  withFilters = true,
}: {
  columns?: number;
  rows?: number;
  withFilters?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>

      {withFilters ? (
        <div className="grid gap-3 rounded-lg border border-hairline bg-surface-1 p-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-8" />
          ))}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-hairline">
        <div className="flex gap-3 border-b border-hairline bg-surface-1 px-3 py-2">
          {Array.from({ length: columns }).map((_, index) => (
            <Skeleton key={index} className="h-3 flex-1" />
          ))}
        </div>

        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div
            key={rowIndex}
            className="flex items-center gap-3 border-b border-hairline px-3 py-2.5 last:border-b-0"
          >
            {Array.from({ length: columns }).map((_, index) => (
              <Skeleton key={index} className={index === 0 ? "h-8 flex-[2]" : "h-3.5 flex-1"} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
