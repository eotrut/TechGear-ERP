"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ShoppingCart } from "lucide-react";

import { DataTable, type ColumnMeta } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { CHANNEL_LABEL } from "@/lib/channels";
import { formatDate, formatTime } from "@/lib/format";
import { formatPeso } from "@/lib/money";

import type { OrderListRow } from "../queries";
import { PAYMENT_METHOD_LABEL } from "../schemas";
import { FulfilmentBadge } from "./badges";

/**
 * The order list. Payment and fulfilment read as two chips, and money columns
 * only exist when the server sent money: a warehouse viewer gets a table
 * without them, not a table with them blanked.
 */
export function OrdersTable({
  rows,
  total,
  page,
  pageCount,
  pageSize,
  sort,
  dir,
  toolbar,
  filtered,
  canCreate,
}: {
  rows: OrderListRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
  toolbar: React.ReactNode;
  filtered: boolean;
  canCreate: boolean;
}) {
  const moneyVisible = rows.some((row) => row.money !== null);

  const columns = useMemo<ColumnDef<OrderListRow, unknown>[]>(() => {
    const list: ColumnDef<OrderListRow, unknown>[] = [
      {
        id: "order",
        header: "Order",
        meta: { label: "Order", locked: true, sortKey: "orderNumber" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="block whitespace-nowrap">
            <Link
              href={`/orders/${row.original.id}`}
              className="font-mono text-[12px] text-ink hover:text-accent-strong"
            >
              {row.original.orderNumber}
            </Link>
          </span>
        ),
      },
      {
        id: "placed",
        header: "Placed",
        meta: {
          label: "Placed",
          sortKey: "placedAt",
          className: "hidden sm:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span
            data-numeric
            className="block font-mono text-[12px] whitespace-nowrap text-ink-muted"
          >
            {formatDate(row.original.placedAt)}
            <span className="ml-1.5 text-ink-subtle">{formatTime(row.original.placedAt)}</span>
          </span>
        ),
      },
      {
        id: "customer",
        header: "Customer",
        meta: { label: "Customer" } satisfies ColumnMeta,
        cell: ({ row }) =>
          row.original.customerName ? (
            <span className="block max-w-[14rem] truncate text-ink">
              {row.original.customerName}
            </span>
          ) : (
            <span className="text-caption text-ink-subtle">Walk-in</span>
          ),
      },
      {
        id: "channel",
        header: "Channel",
        meta: { label: "Channel", className: "hidden md:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-ink-muted">
            {CHANNEL_LABEL[row.original.channel]}
          </span>
        ),
      },
      {
        id: "payment",
        header: "Payment",
        meta: { label: "Payment", className: "hidden sm:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <StatusBadge tone={row.original.payment.tone}>{row.original.payment.label}</StatusBadge>
        ),
      },
      {
        id: "fulfilment",
        header: "Fulfilment",
        meta: { label: "Fulfilment" } satisfies ColumnMeta,
        cell: ({ row }) => <FulfilmentBadge status={row.original.status} />,
      },
      {
        id: "items",
        header: "Items",
        meta: { label: "Items", className: "hidden min-[1600px]:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="block max-w-[18rem]">
            <span className="block truncate text-ink-muted">
              {row.original.leadItem ?? "No items"}
            </span>
            {row.original.lineCount > 1 ? (
              <span className="text-caption text-ink-subtle" data-numeric>
                and {row.original.lineCount - 1} more, {row.original.units} units
              </span>
            ) : null}
          </span>
        ),
      },
      {
        id: "method",
        header: "Paid by",
        meta: {
          label: "Paid by",
          className: "hidden min-[1800px]:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) =>
          row.original.methods.length === 0 ? (
            <span className="text-caption text-ink-subtle">none</span>
          ) : (
            <span className="text-caption whitespace-nowrap text-ink-muted">
              {row.original.methods.map((method) => PAYMENT_METHOD_LABEL[method]).join(" + ")}
            </span>
          ),
      },
      {
        id: "salesperson",
        header: "Sold by",
        meta: {
          label: "Sold by",
          className: "hidden min-[1920px]:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="text-caption whitespace-nowrap text-ink-subtle">
            {row.original.salespersonName ?? CHANNEL_LABEL[row.original.channel]}
          </span>
        ),
      },
    ];

    if (!moneyVisible) {
      // Without money, the count of units is the number that matters: it is what gets picked.
      list.push({
        id: "units",
        header: "Units",
        meta: { label: "Units", align: "right", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="block text-right font-mono text-ink">
            {row.original.units}
          </span>
        ),
      });
    } else {
      list.push({
        id: "total",
        header: "Total",
        meta: {
          label: "Total",
          align: "right",
          sortKey: "total",
          locked: true,
        } satisfies ColumnMeta,
        cell: ({ row }) => {
          const money = row.original.money;
          if (!money) return null;
          return (
            <span className="block text-right whitespace-nowrap">
              <span data-numeric className="font-mono text-ink">
                {formatPeso(money.totalCentavos)}
              </span>
              {money.amountRefundedCentavos > 0 ? (
                <span data-numeric className="block font-mono text-[11px] text-danger">
                  {formatPeso(money.amountRefundedCentavos)} back
                </span>
              ) : null}
            </span>
          );
        },
      });
    }
    return list;
  }, [moneyVisible]);

  return (
    <DataTable
      tableId="orders"
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      total={total}
      page={page}
      pageCount={pageCount}
      pageSize={pageSize}
      sort={sort}
      dir={dir}
      toolbar={toolbar}
      href={(row) => `/orders/${row.id}`}
      noun={["order", "orders"]}
      empty={
        <EmptyState
          icon={ShoppingCart}
          title={filtered ? "No orders match" : "No orders yet"}
          description={
            filtered
              ? "Nothing fits these filters. Widen the dates or clear a filter to see more."
              : "Orders from every channel land here: marketplaces, Facebook, direct and B2B. POS sales join them from the register."
          }
          action={
            !filtered && canCreate ? (
              <Button asChild variant="primary" size="sm">
                <Link href="/orders/new">New order</Link>
              </Button>
            ) : undefined
          }
        />
      }
    />
  );
}
