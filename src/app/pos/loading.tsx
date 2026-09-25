import { Skeleton } from "@/components/ui/skeleton";

/** The register's own shape: the scan bar and item grid, and the cart rail. */
export default function PosLoading() {
  return (
    <div
      className="flex flex-1 flex-col md:grid md:h-[calc(100dvh-3.5rem)] md:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading the register</span>
      <div className="flex flex-col">
        <div className="border-b border-hairline p-3 md:p-4">
          <Skeleton className="h-12 w-full" />
        </div>
        <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 md:grid-cols-2 md:p-4 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 12 }).map((_, index) => (
            <Skeleton key={index} className="h-[6.5rem] rounded-lg" />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3 border-t border-hairline bg-surface-1 p-4 md:border-t-0 md:border-l">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-11 w-full" />
        <div className="flex-1" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-14 w-full" />
      </div>
    </div>
  );
}
