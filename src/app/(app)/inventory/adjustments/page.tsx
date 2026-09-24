import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { AdjustmentsTable } from "@/features/inventory/components/adjustments-table";
import { ListFilters } from "@/components/data-table/list-filters";
import {
  DOCUMENT_PAGE_SIZE,
  listAdjustments,
  warehouseOptions,
} from "@/features/inventory/queries";
import {
  ADJUSTMENT_REASON_META,
  ADJUSTMENT_REASONS,
  adjustmentFiltersSchema,
} from "@/features/inventory/schemas";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Adjustments" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdjustmentsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("inventory.adjust");
  const params = await searchParams;

  const filters = adjustmentFiltersSchema.parse({
    warehouseId: single(params.warehouseId),
    reason: single(params.reason),
    page: single(params.page),
  });

  const withCost = can(user.role, "products.viewCost");
  const [adjustments, warehouses] = await Promise.all([
    listAdjustments(filters, { withCost }),
    warehouseOptions(),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
      <PageHeader
        title="Adjustments"
        description="Manual stock corrections: damage, losses, theft, samples and cycle counts. Every adjustment carries a reason, writes one ledger movement per line, and is recorded in the audit log."
        actions={
          <Button asChild variant="primary" size="sm">
            <Link href="/inventory/adjustments/new">
              <Plus aria-hidden />
              New adjustment
            </Link>
          </Button>
        }
      />

      <AdjustmentsTable
        rows={adjustments.rows}
        total={adjustments.total}
        page={adjustments.page}
        pageCount={adjustments.pageCount}
        pageSize={DOCUMENT_PAGE_SIZE}
        withCost={withCost}
        canCreate
        filtered={Boolean(filters.warehouseId || filters.reason)}
        toolbar={
          <ListFilters
            key="adjustment-filters"
            fields={[
              {
                kind: "select",
                name: "warehouseId",
                label: "Warehouse",
                allLabel: "All warehouses",
                options: warehouses.map((warehouse) => ({
                  value: warehouse.id,
                  label: warehouse.code,
                })),
              },
              {
                kind: "select",
                name: "reason",
                label: "Reason",
                allLabel: "Any reason",
                options: ADJUSTMENT_REASONS.map((reason) => ({
                  value: reason,
                  label: ADJUSTMENT_REASON_META[reason].label,
                })),
              },
            ]}
          />
        }
      />
    </div>
  );
}
