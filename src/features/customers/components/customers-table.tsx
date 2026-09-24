"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Users } from "lucide-react";

import { DataTable, type ColumnMeta } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { CHANNEL_LABEL } from "@/lib/channels";
import { formatDate, formatRelative } from "@/lib/format";
import { formatPeso } from "@/lib/money";

import type { CustomerListRow } from "../queries";
import { CustomerTypeBadge, SegmentBadge } from "./badges";

/**
 * The customer directory. Lifetime value and order count arrive as null for
 * roles without Customer 360, stripped on the server, and the columns are not
 * even built for them; nor do their rows link to a page they cannot open.
 */
export function CustomersTable({
  rows,
  total,
  page,
  pageCount,
  pageSize,
  sort,
  dir,
  toolbar,
  filtered,
  canView360,
  canCreate,
}: {
  rows: CustomerListRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
  toolbar: React.ReactNode;
  filtered: boolean;
  canView360: boolean;
  canCreate: boolean;
}) {
  const columns = useMemo<ColumnDef<CustomerListRow, unknown>[]>(() => {
    const list: ColumnDef<CustomerListRow, unknown>[] = [
      {
        id: "name",
        header: "Customer",
        meta: { label: "Customer", locked: true, sortKey: "name" } satisfies ColumnMeta,
        cell: ({ row }) => {
          const customer = row.original;
          const name = (
            <span className="block max-w-[18rem] truncate font-medium text-ink">
              {customer.displayName}
            </span>
          );
          return (
            <div className="min-w-0">
              {canView360 ? (
                <Link href={`/customers/${customer.id}`} className="hover:text-accent-strong">
                  {name}
                </Link>
              ) : (
                name
              )}
              <span className="block max-w-[18rem] truncate text-caption text-ink-subtle">
                <span className="font-mono text-[11px]">{customer.code}</span>
                {customer.email
                  ? ` · ${customer.email}`
                  : customer.phone
                    ? ` · ${customer.phone}`
                    : ""}
              </span>
            </div>
          );
        },
      },
      {
        id: "segment",
        header: "Segment",
        meta: { label: "Segment" } satisfies ColumnMeta,
        cell: ({ row }) => <SegmentBadge segment={row.original.segment} />,
      },
      {
        id: "type",
        header: "Type",
        meta: { label: "Type", className: "hidden md:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => <CustomerTypeBadge type={row.original.type} />,
      },
      {
        id: "location",
        header: "Location",
        meta: { label: "Location", className: "hidden lg:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) =>
          row.original.city ? (
            <span className="block max-w-[14rem] truncate text-body-sm text-ink-muted">
              {row.original.city}
              <span className="text-ink-subtle">, {row.original.province}</span>
            </span>
          ) : (
            <span className="text-caption text-ink-subtle">no address</span>
          ),
      },
      {
        id: "channel",
        header: "Source",
        meta: { label: "Source channel", className: "hidden xl:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) =>
          row.original.sourceChannel ? (
            <span className="text-body-sm whitespace-nowrap text-ink-muted">
              {CHANNEL_LABEL[row.original.sourceChannel]}
            </span>
          ) : (
            <span className="text-caption text-ink-subtle">unknown</span>
          ),
      },
    ];

    if (canView360) {
      list.push(
        {
          id: "orders",
          header: "Orders",
          meta: {
            label: "Orders",
            align: "right",
            sortKey: "orders",
            className: "hidden sm:table-cell",
          } satisfies ColumnMeta,
          cell: ({ row }) => (
            <span data-numeric className="font-mono text-ink-muted">
              {row.original.orderCount ?? 0}
            </span>
          ),
        },
        {
          id: "ltv",
          header: "Lifetime value",
          meta: { label: "Lifetime value", align: "right", sortKey: "ltv" } satisfies ColumnMeta,
          cell: ({ row }) => (
            <span data-numeric className="font-mono whitespace-nowrap text-ink">
              {formatPeso(row.original.lifetimeValueCentavos ?? 0)}
            </span>
          ),
        },
      );
    }

    list.push({
      id: "lastOrder",
      header: "Last order",
      meta: {
        label: "Last order",
        sortKey: "lastOrder",
        className: "hidden md:table-cell",
      } satisfies ColumnMeta,
      cell: ({ row }) =>
        row.original.lastOrderAt ? (
          <span
            data-numeric
            title={formatDate(row.original.lastOrderAt)}
            className="font-mono text-[12px] whitespace-nowrap text-ink-muted"
          >
            {formatRelative(row.original.lastOrderAt)}
          </span>
        ) : (
          <span className="text-caption text-ink-subtle">never</span>
        ),
    });

    return list;
  }, [canView360]);

  return (
    <DataTable
      tableId="customers"
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
      href={canView360 ? (row) => `/customers/${row.id}` : undefined}
      noun={["customer", "customers"]}
      empty={
        <EmptyState
          icon={Users}
          title={filtered ? "No customers match" : "No customers yet"}
          description={
            filtered
              ? "Nobody fits every filter at once. Clear one, or search by phone number or customer code instead."
              : "Customers appear here as they buy, and as leads are converted. Add one by hand to start."
          }
          action={
            !filtered && canCreate ? (
              <Button asChild variant="primary" size="sm">
                <Link href="/customers/new">New customer</Link>
              </Button>
            ) : undefined
          }
        />
      }
    />
  );
}
