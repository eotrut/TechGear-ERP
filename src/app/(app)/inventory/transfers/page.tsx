import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { TransfersTable } from "@/features/inventory/components/transfers-table";
import { ViewTabs } from "@/components/data-table/view-tabs";
import { DOCUMENT_PAGE_SIZE, listTransfers } from "@/features/inventory/queries";
import {
  TRANSFER_STATUSES,
  transferFiltersSchema,
  type TransferStatusValue,
} from "@/features/inventory/schemas";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Transfers" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const TAB_LABEL: Record<TransferStatusValue, string> = {
  DRAFT: "Drafts",
  IN_TRANSIT: "In transit",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

export default async function TransfersPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePermission("inventory.transfer");
  const params = await searchParams;

  const filters = transferFiltersSchema.parse({
    status: single(params.status),
    page: single(params.page),
  });

  const transfers = await listTransfers(filters);
  const all = Object.values(transfers.counts).reduce((sum, count) => sum + (count ?? 0), 0);

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
      <PageHeader
        title="Transfers"
        description="Stock moving between warehouses. Dispatch takes it out of the source; receiving puts it into the destination. In between it is on the road and counted in neither."
        actions={
          <Button asChild variant="primary" size="sm">
            <Link href="/inventory/transfers/new">
              <Plus aria-hidden />
              New transfer
            </Link>
          </Button>
        }
      />

      <TransfersTable
        rows={transfers.rows}
        total={transfers.total}
        page={transfers.page}
        pageCount={transfers.pageCount}
        pageSize={DOCUMENT_PAGE_SIZE}
        filtered={Boolean(filters.status)}
        toolbar={
          <ViewTabs
            key="transfer-tabs"
            tabs={[
              { label: "All", href: "/inventory/transfers", active: !filters.status, count: all },
              ...TRANSFER_STATUSES.map((status) => ({
                label: TAB_LABEL[status],
                href: `/inventory/transfers?status=${status}`,
                active: filters.status === status,
                count: transfers.counts[status] ?? 0,
              })),
            ]}
          />
        }
      />
    </div>
  );
}
