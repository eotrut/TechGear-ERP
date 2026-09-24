import { PageHeader } from "@/components/layout/page-header";
import { TableSkeleton } from "@/components/feedback/table-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
      <PageHeader title="Stock" />
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="border-t border-hairline pt-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-5 w-20" />
          </div>
        ))}
      </div>
      <TableSkeleton columns={7} />
    </div>
  );
}
