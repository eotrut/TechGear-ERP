import { TableSkeleton } from "@/components/feedback/table-skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level loading states. Each keeps the real page title so the heading
 * does not jump when the data lands, and mirrors the shape of what is coming:
 * a list, a record with a side rail, a form, or a board of columns.
 */
export function PageLoading({
  title,
  variant = "list",
  columns = 7,
}: {
  title: string;
  variant?: "list" | "record" | "form" | "board";
  columns?: number;
}) {
  if (variant === "list") {
    return (
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
        <PageHeader title={title} />
        <TableSkeleton columns={columns} />
      </div>
    );
  }

  if (variant === "board") {
    return (
      <div className="flex w-full flex-col gap-5" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading</span>
        <PageHeader title={title} />
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex flex-col gap-2 border-t border-hairline pt-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-32" />
            </div>
          ))}
        </div>
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 6 }).map((_, column) => (
            <div
              key={column}
              className="flex w-[272px] shrink-0 flex-col gap-2 rounded-lg border border-hairline bg-surface-1 p-2"
            >
              <Skeleton className="h-4 w-28" />
              {Array.from({ length: 4 - (column % 3) }).map((_, card) => (
                <Skeleton key={card} className="h-24" />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="mx-auto flex w-full max-w-[1280px] flex-col gap-5"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading</span>
      <PageHeader title={title} />
      {variant === "record" ? (
        <>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="flex flex-col gap-2 border-t border-hairline pt-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-28" />
              </div>
            ))}
          </div>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <TableSkeleton columns={columns} rows={5} withFilters={false} />
            <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface-1 p-4">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-4" />
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 3 }).map((_, section) => (
            <div
              key={section}
              className="grid gap-3 rounded-lg border border-hairline bg-surface-1 p-4 sm:grid-cols-2"
            >
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex flex-col gap-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-8" />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
