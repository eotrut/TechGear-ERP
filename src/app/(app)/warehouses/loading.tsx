import { PageHeader } from "@/components/layout/page-header";
import { TableSkeleton } from "@/components/feedback/table-skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <PageHeader title="Warehouses" />
      <TableSkeleton />
    </div>
  );
}
