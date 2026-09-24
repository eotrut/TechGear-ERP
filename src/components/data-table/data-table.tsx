"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * The table shell every resource list in the app is built from.
 *
 * Pagination, sorting and filtering are server-side and live in the URL, so a
 * filtered view is a link: shareable, bookmarkable, and restored by the back
 * button. TanStack Table is in manual mode and does the parts that genuinely
 * belong on the client, which are column visibility and row selection.
 *
 * Column widths are left to the browser. Fixed widths on a data table are a
 * promise you cannot keep once a real product name arrives.
 */

export type ColumnMeta = {
  /** Header label used by the column visibility menu. */
  label: string;
  /** Money and quantities sit right, per the design direction. */
  align?: "right";
  /** Tailwind classes, typically responsive hiding such as "hidden lg:table-cell". */
  className?: string;
  /** Sort key sent to the server. Absent means the column is not sortable. */
  sortKey?: string;
  /** Columns the table cannot function without stay out of the visibility menu. */
  locked?: boolean;
};

function metaOf(column: { columnDef: { meta?: unknown } }): ColumnMeta {
  return (column.columnDef.meta ?? { label: "" }) as ColumnMeta;
}

export type DataTableProps<T> = {
  /** Stable id, used to remember column choices for this table only. */
  tableId: string;
  data: T[];
  columns: ColumnDef<T, unknown>[];
  getRowId: (row: T) => string;
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
  /** Rendered above the table: filters, search, actions. */
  toolbar?: React.ReactNode;
  /** Replaces the toolbar while rows are selected. */
  bulkActions?: (selectedIds: string[], clear: () => void) => React.ReactNode;
  selectable?: boolean;
  empty: React.ReactNode;
  /** Row click target, which is what makes the whole row feel like a link. */
  href?: (row: T) => string;
  /** Singular and plural noun for the result count. */
  noun?: [string, string];
};

export function DataTable<T>({
  tableId,
  data,
  columns,
  getRowId,
  total,
  page,
  pageCount,
  pageSize,
  sort,
  dir,
  toolbar,
  bulkActions,
  selectable = false,
  empty,
  href,
  noun = ["result", "results"],
}: DataTableProps<T>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const storageKey = `techgear.table.${tableId}.columns`;

  // Column choices are a per-person convenience, so they live in the browser
  // rather than the URL or the database. Storage can throw in private windows.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) setColumnVisibility(JSON.parse(saved) as VisibilityState);
    } catch {
      // No saved preference is a perfectly good state to start in.
    }
  }, [storageKey]);

  function updateVisibility(next: VisibilityState) {
    setColumnVisibility(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Ignore: the table still works, it just forgets between visits.
    }
  }

  // A new page of results is a new set of rows; keeping ticks would select
  // whatever happens to land in the same position.
  useEffect(() => {
    setRowSelection({});
  }, [data]);

  const table = useReactTable({
    data,
    columns,
    getRowId: (row) => getRowId(row),
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    enableRowSelection: selectable,
    state: { columnVisibility, rowSelection },
    onColumnVisibilityChange: (updater) => {
      const next = typeof updater === "function" ? updater(columnVisibility) : updater;
      updateVisibility(next);
    },
    onRowSelectionChange: setRowSelection,
  });

  const selectedIds = useMemo(
    () =>
      Object.entries(rowSelection)
        .filter(([, on]) => on)
        .map(([id]) => id),
    [rowSelection],
  );

  function withParams(changes: Record<string, string | null>): string {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    return query === "" ? pathname : `${pathname}?${query}`;
  }

  function toggleSort(key: string) {
    // Same column flips direction; a new column starts ascending, which is
    // what people expect from names and descending from dates only by default.
    const nextDir = sort === key && dir === "asc" ? "desc" : "asc";
    router.push(withParams({ sort: key, dir: nextDir, page: null }));
  }

  const hideable = table.getAllLeafColumns().filter((column) => !metaOf(column).locked);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;

  return (
    <div className="flex flex-col gap-3">
      {selectable && selectedIds.length > 0 && bulkActions ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent-fill/40 bg-accent-wash px-3 py-2">
          <span className="text-body-sm font-medium text-ink">
            <span data-numeric>{selectedIds.length}</span> selected
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {bulkActions(selectedIds, () => setRowSelection({}))}
          </div>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setRowSelection({})}>
            Clear selection
          </Button>
        </div>
      ) : (
        toolbar
      )}

      {data.length === 0 ? (
        empty
      ) : (
        <>
          {/* Relative, so absolutely positioned children such as sr-only
              header labels are clipped by the scroller instead of widening
              the page on a phone. */}
          <div className="relative overflow-x-auto rounded-lg border border-hairline">
            <table className="w-full border-collapse text-body-sm">
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id} className="border-b border-hairline bg-surface-1">
                    {headerGroup.headers.map((header) => {
                      const meta = metaOf(header.column);
                      const active = meta.sortKey === sort;

                      return (
                        <th
                          key={header.id}
                          scope="col"
                          aria-sort={
                            active ? (dir === "asc" ? "ascending" : "descending") : undefined
                          }
                          className={cn(
                            "px-2 py-2 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase sm:px-3",
                            meta.align === "right" && "text-right",
                            meta.className,
                          )}
                        >
                          {meta.sortKey ? (
                            <button
                              type="button"
                              onClick={() => toggleSort(meta.sortKey as string)}
                              className={cn(
                                // Preflight resets text-transform on buttons, so
                                // the header's small caps have to be restated.
                                "inline-flex items-center gap-1 rounded-xs tracking-[0.06em] uppercase hover:text-ink",
                                active && "text-ink",
                                meta.align === "right" && "flex-row-reverse",
                              )}
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {active ? (
                                dir === "asc" ? (
                                  <ArrowUp className="size-3" aria-hidden />
                                ) : (
                                  <ArrowDown className="size-3" aria-hidden />
                                )
                              ) : (
                                <ChevronsUpDown className="size-3 opacity-40" aria-hidden />
                              )}
                            </button>
                          ) : (
                            flexRender(header.column.columnDef.header, header.getContext())
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>

              <tbody>
                {table.getRowModel().rows.map((row) => {
                  const target = href?.(row.original);

                  return (
                    <tr
                      key={row.id}
                      data-selected={row.getIsSelected() ? "true" : undefined}
                      onClick={
                        target
                          ? (event) => {
                              // Let checkboxes, links and buttons inside the row win.
                              if ((event.target as HTMLElement).closest("a,button,input,label")) {
                                return;
                              }
                              router.push(target);
                            }
                          : undefined
                      }
                      className={cn(
                        "border-b border-hairline last:border-b-0",
                        "transition-colors hover:bg-surface-2",
                        target && "cursor-pointer",
                        // The selected-row indicator is one of the few places
                        // the accent is allowed to appear.
                        row.getIsSelected() &&
                          "bg-accent-wash shadow-[inset_2px_0_0_0_var(--accent-fill)]",
                      )}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const meta = metaOf(cell.column);
                        return (
                          <td
                            key={cell.id}
                            className={cn(
                              "px-2 py-2 align-middle sm:px-3",
                              meta.align === "right" && "text-right",
                              meta.className,
                            )}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-body-sm text-ink-subtle">
              <span data-numeric>{from}</span> to <span data-numeric>{from + data.length - 1}</span>{" "}
              of <span data-numeric>{total.toLocaleString("en-PH")}</span>{" "}
              {total === 1 ? noun[0] : noun[1]}
            </p>

            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <Settings2 aria-hidden />
                    Columns
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {hideable.map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) => column.toggleVisibility(Boolean(value))}
                      onSelect={(event) => event.preventDefault()}
                    >
                      {metaOf(column).label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="flex items-center gap-1">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => router.push(withParams({ page: String(page - 1) }))}
                >
                  Previous
                </Button>
                <span className="px-2 text-body-sm text-ink-subtle">
                  <span data-numeric>{page}</span> of <span data-numeric>{pageCount}</span>
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= pageCount}
                  onClick={() => router.push(withParams({ page: String(page + 1) }))}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
