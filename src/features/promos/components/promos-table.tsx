"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Plus, Ticket } from "lucide-react";
import { toast } from "sonner";

import { DataTable, type ColumnMeta } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/format";
import { formatPeso } from "@/lib/money";

import { togglePromoAction } from "../actions";
import type { PromoRow } from "../queries";
import type { PromoFormValues } from "../schemas";
import { describePromoValue, type PromoState } from "../services/promo-rules";
import { PromoDialog } from "./promo-dialog";

const STATE_TONE: Record<PromoState, StatusTone> = {
  active: "success",
  scheduled: "info",
  expired: "neutral",
  "used up": "warning",
  inactive: "neutral",
};

/** Promo codes with usage against their limit and what they have given away. */
export function PromosTable({
  rows,
  total,
  page,
  pageCount,
  pageSize,
  toolbar,
  canManage,
  newDefaults,
}: {
  rows: PromoRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  toolbar: React.ReactNode;
  canManage: boolean;
  newDefaults: PromoFormValues;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<PromoRow | "new" | null>(null);
  const [isPending, startTransition] = useTransition();

  const columns = useMemo<ColumnDef<PromoRow, unknown>[]>(() => {
    const list: ColumnDef<PromoRow, unknown>[] = [
      {
        id: "code",
        header: "Code",
        meta: { label: "Code", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="block">
            <span className="font-mono text-[12px] text-ink">{row.original.code}</span>
            <span className="block max-w-[18rem] truncate text-caption text-ink-subtle">
              {row.original.description}
            </span>
          </span>
        ),
      },
      {
        id: "state",
        header: "State",
        meta: { label: "State", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => (
          <StatusBadge tone={STATE_TONE[row.original.state]}>{row.original.state}</StatusBadge>
        ),
      },
      {
        id: "value",
        header: "Discount",
        meta: { label: "Discount" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="block whitespace-nowrap">
            <span className="font-mono text-[12px] text-ink">
              {describePromoValue(row.original)}
            </span>
            {row.original.minSubtotalCentavos > 0 ? (
              <span className="block text-caption text-ink-subtle" data-numeric>
                over {formatPeso(row.original.minSubtotalCentavos)}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        id: "dates",
        header: "Runs",
        meta: { label: "Runs", className: "hidden md:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="font-mono text-[12px] whitespace-nowrap text-ink-muted">
            {formatDate(row.original.startsAt)} to {formatDate(row.original.endsAt)}
          </span>
        ),
      },
      {
        id: "usage",
        header: "Used",
        meta: { label: "Used", align: "right" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="block text-right font-mono whitespace-nowrap text-ink">
            {row.original.usageCount}
            {row.original.usageLimit !== null ? (
              <span className="text-ink-subtle"> of {row.original.usageLimit}</span>
            ) : null}
            {row.original.perCustomerLimit !== null ? (
              <span className="block text-[11px] text-ink-subtle">
                {row.original.perCustomerLimit} per customer
              </span>
            ) : null}
          </span>
        ),
      },
      {
        id: "given",
        header: "Given away",
        meta: {
          label: "Given away",
          align: "right",
          className: "hidden lg:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span
            data-numeric
            className="block text-right font-mono whitespace-nowrap text-ink-muted"
          >
            {formatPeso(row.original.discountGivenCentavos)}
          </span>
        ),
      },
    ];
    if (canManage) {
      list.push({
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        meta: { label: "Actions", locked: true, align: "right" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await togglePromoAction({
                    promoId: row.original.id,
                    isActive: !row.original.isActive,
                  });
                  if (!result.ok) toast.error(result.error);
                  else {
                    toast.success(result.message ?? "Saved.");
                    router.refresh();
                  }
                })
              }
            >
              {row.original.isActive ? "Deactivate" : "Reactivate"}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Edit ${row.original.code}`}
              onClick={() => setEditing(row.original)}
            >
              <Pencil aria-hidden />
            </Button>
          </span>
        ),
      });
    }
    return list;
  }, [canManage, isPending, router]);

  return (
    <>
      <DataTable
        tableId="promos"
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        total={total}
        page={page}
        pageCount={pageCount}
        pageSize={pageSize}
        sort="endsAt"
        dir="desc"
        toolbar={
          <div className="flex flex-wrap items-end justify-between gap-3">
            {toolbar}
            {canManage ? (
              <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
                <Plus aria-hidden />
                New promo
              </Button>
            ) : null}
          </div>
        }
        noun={["promo", "promos"]}
        empty={
          <EmptyState
            icon={Ticket}
            title="No promos here"
            description="Promo codes take a percent or a peso amount off the goods on an order, within their dates and usage limits."
            action={
              canManage ? (
                <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
                  New promo
                </Button>
              ) : undefined
            }
          />
        }
      />
      {editing ? (
        <PromoDialog
          key={editing === "new" ? "new" : editing.id}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          promoId={editing === "new" ? undefined : editing.id}
          defaults={editing === "new" ? newDefaults : editing.values}
          usageCount={editing === "new" ? 0 : editing.usageCount}
        />
      ) : null}
    </>
  );
}
