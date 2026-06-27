"use client";

import * as React from "react";

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

const ALIGN_CLASS = {
  left: "",
  center: "text-center",
  right: "text-right",
} as const;

export type DataTableColumn<T> = {
  /** Stable id, used as the React key for the column. */
  id: string;
  /** Header content. Omit for an actions / blank column. */
  header?: React.ReactNode;
  /** Renders the cell for a given row. */
  cell: (row: T) => React.ReactNode;
  /** Text alignment applied to both the header and the cells. */
  align?: "left" | "center" | "right";
  /** Extra className for the `<th>` — use it for the column width (e.g. "w-32"). */
  headerClassName?: string;
  /** Extra className for the `<td>`. */
  className?: string;
};

export type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  data: readonly T[];
  /** Stable React key per row. */
  getRowKey: (row: T, index: number) => React.Key;
  /** Shown (spanning all columns) when there are no rows and not loading. */
  emptyMessage?: React.ReactNode;
  /** When true, renders skeleton rows instead of the data / empty state. */
  isLoading?: boolean;
  /** Number of skeleton rows to render while loading. */
  skeletonRows?: number;
  /** Optional per-row click handler (adds a pointer cursor). */
  onRowClick?: (row: T) => void;
  /** Optional per-row extra className. */
  rowClassName?: (row: T) => string | undefined;
  /** Wrapper override. Pass `null` to render the bare table with no card border. */
  wrapperClassName?: string | null;
};

/**
 * Shared table for the app. Every list renders through this so the empty state,
 * loading skeleton, alignment, and card border are consistent everywhere — each
 * call only passes the columns/data it needs. Complex grids (editable matrices,
 * trees, running-balance ledgers) stay custom.
 */
export function DataTable<T>({
  columns,
  data,
  getRowKey,
  emptyMessage = "No hay datos.",
  isLoading = false,
  skeletonRows = 5,
  onRowClick,
  rowClassName,
  wrapperClassName,
}: DataTableProps<T>) {
  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead
              key={col.id}
              className={cn(col.align && ALIGN_CLASS[col.align], col.headerClassName)}
            >
              {col.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          Array.from({ length: skeletonRows }).map((_, rowIndex) => (
            <TableRow key={`skeleton-${rowIndex}`}>
              {columns.map((col) => (
                <TableCell key={col.id} className={col.className}>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : data.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={columns.length}
              className="py-10 text-center text-sm text-muted-foreground"
            >
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          data.map((row, index) => (
            <TableRow
              key={getRowKey(row, index)}
              className={cn(onRowClick && "cursor-pointer", rowClassName?.(row))}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((col) => (
                <TableCell
                  key={col.id}
                  className={cn(col.align && ALIGN_CLASS[col.align], col.className)}
                >
                  {col.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );

  if (wrapperClassName === null) return table;
  return (
    <div className={cn("rounded-lg border bg-card", wrapperClassName)}>{table}</div>
  );
}
