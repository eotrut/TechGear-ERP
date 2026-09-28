import { TableSkeleton } from "@/components/feedback/table-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading state shaped like a report: heading, a row of figures, a chart
 * panel and a table, so nothing jumps when the numbers land.
 */
export function ReportLoading({ tiles = 4 }: { tiles?: number }) {
  return (
    <div
      className="mx-auto flex w-full max-w-[1440px] flex-col gap-6"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading report</span>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
        {Array.from({ length: tiles }).map((_, index) => (
          <div key={index} className="flex flex-col gap-2 border-t border-hairline pt-2.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-hairline p-4">
        <Skeleton className="h-[240px] w-full" />
      </div>
      <TableSkeleton columns={5} rows={6} withFilters={false} />
    </div>
  );
}
