import { Skeleton } from "@/components/ui/skeleton";

/**
 * The receipt's own shape: the sale summary beside the 80mm slip. Without it
 * this route inherits the register's skeleton, a scan bar and item grid, for
 * a page that has neither.
 */
export default function PosReceiptLoading() {
  return (
    <div className="flex-1 px-4 py-6 md:py-10" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the receipt</span>
      <div className="mx-auto grid w-full max-w-4xl gap-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="flex flex-col gap-6">
          <div className="flex items-start gap-3">
            <Skeleton className="size-10 shrink-0 rounded-md" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-6 w-44" />
              <Skeleton className="h-3.5 w-56" />
            </div>
          </div>
          <div className="flex flex-col gap-2.5 border-y border-hairline py-4">
            <div className="flex items-center justify-between gap-4">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-6 w-28" />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3.5 w-24" />
            </div>
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-36" />
            <Skeleton className="h-10 w-28" />
          </div>
        </div>
        <Skeleton className="mx-auto h-[28rem] w-[300px] rounded-md" />
      </div>
    </div>
  );
}
