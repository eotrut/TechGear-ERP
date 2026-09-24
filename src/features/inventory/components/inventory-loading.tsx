import { PageHeader } from "@/components/layout/page-header";
import { TableSkeleton } from "@/components/feedback/table-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level loading state for the inventory pages. Each route renders its
 * own title so the heading does not jump when the data arrives, and the
 * skeleton mirrors that page's shape: a list, or a document with lines.
 */
export function InventoryLoading({
  title,
  variant = "list",
  columns = 7,
}: {
  title: string;
  variant?: "list" | "document" | "form";
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

  return (
    <div
      className="mx-auto flex w-full max-w-[1280px] flex-col gap-5"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading</span>
      <PageHeader title={title} />
      <div className="grid gap-3 rounded-lg border border-hairline bg-surface-1 p-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8" />
          </div>
        ))}
      </div>
      <TableSkeleton columns={variant === "form" ? 4 : columns} rows={4} withFilters={false} />
    </div>
  );
}
