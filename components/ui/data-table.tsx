"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
} from "lucide-react";
import * as React from "react";
import {
  type ColumnDef,
  type RowData,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// Per-column UI hints, set via ColumnDef.meta.
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Text alignment for the header + cells. */
    align?: "left" | "center" | "right";
    /** Extra className for the <th>. Use for width (e.g. "w-32"). */
    headerClassName?: string;
    /** Extra className for the <td>. */
    cellClassName?: string;
  }
}

export type { ColumnDef } from "@tanstack/react-table";

const ALIGN: Record<"left" | "center" | "right", string> = {
  left: "",
  center: "text-center",
  right: "text-right",
};

export type DataTableProps<T> = {
  columns: ColumnDef<T>[];
  data: T[];
  /** Stable row id (recommended). */
  getRowId?: (row: T) => string;
  /** Shown (spanning all columns) when there are no rows and not loading. */
  emptyMessage?: React.ReactNode;
  /** Render skeleton rows instead of the data / empty state. */
  isLoading?: boolean;
  skeletonRows?: number;
  /** Client-side pagination controls. */
  enablePagination?: boolean;
  initialPageSize?: number;
  /** Initial sort, e.g. [{ id: "date", desc: true }]. */
  defaultSorting?: SortingState;
  onRowClick?: (row: T) => void;
  /** Wrapper override. `null` renders the bare table (no card border). */
  wrapperClassName?: string | null;
};

/**
 * The app's single table. Every list renders through it (each call passing only
 * its TanStack ColumnDef[] and data) so sorting, pagination, the empty state,
 * loading skeletons, and the card border stay consistent everywhere.
 */
export function DataTable<T>({
  columns,
  data,
  getRowId,
  emptyMessage = "No hay datos.",
  isLoading = false,
  skeletonRows = 5,
  enablePagination = false,
  initialPageSize = 20,
  defaultSorting,
  onRowClick,
  wrapperClassName,
}: DataTableProps<T>) {
  const [sorting, setSorting] = React.useState<SortingState>(
    defaultSorting ?? [],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: enablePagination
      ? getPaginationRowModel()
      : undefined,
    initialState: enablePagination
      ? { pagination: { pageSize: initialPageSize } }
      : undefined,
  });

  const rows = table.getRowModel().rows;

  const tableEl = (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((hg) => (
          <TableRow key={hg.id}>
            {hg.headers.map((header) => {
              const align = header.column.columnDef.meta?.align;
              const canSort = header.column.getCanSort();
              const sorted = header.column.getIsSorted();
              return (
                <TableHead
                  key={header.id}
                  className={cn(
                    align && ALIGN[align],
                    header.column.columnDef.meta?.headerClassName,
                  )}
                >
                  {header.isPlaceholder ? null : canSort ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className={cn(
                        "inline-flex items-center gap-1 hover:text-foreground",
                        align === "right" && "flex-row-reverse",
                      )}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      {sorted === "asc" ? (
                        <ArrowUp className="size-3.5" />
                      ) : sorted === "desc" ? (
                        <ArrowDown className="size-3.5" />
                      ) : (
                        <ChevronsUpDown className="size-3.5 opacity-40" />
                      )}
                    </button>
                  ) : (
                    flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {isLoading ? (
          Array.from({ length: skeletonRows }).map((_, r) => (
            <TableRow key={`skeleton-${r}`}>
              {columns.map((_col, c) => (
                <TableCell key={c}>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : rows.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={columns.length}
              className="py-10 text-center text-sm text-muted-foreground"
            >
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow
              key={row.id}
              className={cn(onRowClick && "cursor-pointer")}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
            >
              {row.getVisibleCells().map((cell) => {
                const align = cell.column.columnDef.meta?.align;
                return (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      align && ALIGN[align],
                      cell.column.columnDef.meta?.cellClassName,
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                );
              })}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );

  const pagination =
    enablePagination && !isLoading && rows.length > 0 ? (
      <div className="flex items-center justify-between border-t px-3 py-2 text-sm">
        <span className="text-muted-foreground">
          {table.getFilteredRowModel().rows.length} fila
          {table.getFilteredRowModel().rows.length === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">
            Página {table.getState().pagination.pageIndex + 1} de{" "}
            {table.getPageCount()}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Anterior"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label="Siguiente"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    ) : null;

  if (wrapperClassName === null) {
    return (
      <>
        {tableEl}
        {pagination}
      </>
    );
  }
  return (
    <div className={cn("rounded-lg border bg-card", wrapperClassName)}>
      {tableEl}
      {pagination}
    </div>
  );
}
