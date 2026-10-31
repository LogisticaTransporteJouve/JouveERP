"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
} from "lucide-react";
import * as React from "react";
import {
  type CellData,
  type ColumnDef as TableColumnDef,
  createExpandedRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  type ExpandedState,
  flexRender,
  metaHelper,
  type OnChangeFn,
  type RowData,
  rowExpandingFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_datetime,
  sortFn_text,
  type SortingState,
  tableFeatures,
  useTable,
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

/** Per-column UI hints, set via ColumnDef.meta. */
type DataTableColumnMeta = {
  /** Text alignment for the header + cells. */
  align?: "left" | "center" | "right";
  /** Extra className for the <th>. Use for width (e.g. "w-32"). */
  headerClassName?: string;
  /** Extra className for the <td>. */
  cellClassName?: string;
  /** Mobile (< md) behavior. Once ANY column sets this, the table switches
   *  to mobile mode below md: "primary" columns stay visible, "secondary"
   *  (and unannotated) columns move into a per-row expandable panel, and
   *  "hidden" columns disappear. Desktop rendering never changes. */
  mobile?: "primary" | "secondary" | "hidden";
};

// Every DataTable registers the same features. Pagination and expansion are
// switched per table through `manualPagination` and `getSubRows`; the sort
// functions are the ones `sortFn: "auto"` resolves to.
const features = tableFeatures({
  rowSortingFeature,
  rowExpandingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  expandedRowModel: createExpandedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    text: sortFn_text,
    datetime: sortFn_datetime,
  },
  columnMeta: metaHelper<DataTableColumnMeta>(),
});

export type ColumnDef<
  TData extends RowData,
  TValue extends CellData = CellData,
> = TableColumnDef<typeof features, TData, TValue>;
export type { ExpandedState } from "@tanstack/react-table";

const ALIGN: Record<"left" | "center" | "right", string> = {
  left: "",
  center: "text-center",
  right: "text-right",
};

export type DataTableProps<T extends RowData> = {
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
  /** Sub-rows accessor — enables hierarchical (tree) rendering. Cells can use
   *  row.depth / row.getCanExpand() / row.getToggleExpandedHandler() to draw
   *  the indentation + expander. */
  getSubRows?: (row: T) => T[] | undefined;
  /** Controlled expansion state (use with getSubRows). */
  expanded?: ExpandedState;
  onExpandedChange?: OnChangeFn<ExpandedState>;
  /** Rendered below the table body, inside the card (e.g. an infinite-scroll
   *  "load more" sentinel for tables that page their own data). */
  footer?: React.ReactNode;
  /** Wrapper override. `null` renders the bare table (no card border). */
  wrapperClassName?: string | null;
  /** Renders a full-width header row before each run of rows sharing a key.
   *  Rows must already arrive ordered by that key. */
  groupBy?: {
    key: (row: T) => string;
    header: (key: string) => React.ReactNode;
  };
};

/**
 * The app's single table. Every list renders through it (each call passing only
 * its TanStack ColumnDef[] and data) so sorting, pagination, the empty state,
 * loading skeletons, and the card border stay consistent everywhere.
 */
export function DataTable<T extends RowData>({
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
  getSubRows,
  expanded,
  onExpandedChange,
  footer,
  wrapperClassName,
  groupBy,
}: DataTableProps<T>) {
  const [sorting, setSorting] = React.useState<SortingState>(
    defaultSorting ?? [],
  );
  const [mobileExpanded, setMobileExpanded] = React.useState<
    Record<string, boolean>
  >({});

  // Mobile mode activates only when the caller annotated its columns.
  const mobileMode = columns.some((c) => c.meta?.mobile != null);

  const table = useTable({
    features,
    data,
    columns,
    state: { sorting, ...(expanded !== undefined ? { expanded } : {}) },
    onSortingChange: setSorting,
    onExpandedChange,
    getRowId,
    getSubRows,
    manualPagination: !enablePagination,
    initialState: enablePagination
      ? { pagination: { pageIndex: 0, pageSize: initialPageSize } }
      : undefined,
  });

  const rows = table.getRowModel().rows;

  const tableEl = (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((hg) => (
          <TableRow key={hg.id}>
            {mobileMode && <TableHead className="w-8 md:hidden" />}
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
                    mobileMode &&
                      header.column.columnDef.meta?.mobile !== "primary" &&
                      "hidden md:table-cell",
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
              {mobileMode && <TableCell className="md:hidden" />}
              {columns.map((col, c) => (
                <TableCell
                  key={c}
                  className={cn(
                    mobileMode &&
                      col.meta?.mobile !== "primary" &&
                      "hidden md:table-cell",
                  )}
                >
                  <Skeleton className="h-4 w-full" />
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : rows.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={columns.length + (mobileMode ? 1 : 0)}
              className="py-10 text-center text-sm text-muted-foreground"
            >
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row, index) => {
            const prevRow = rows[index - 1];
            const groupKey = groupBy?.key(row.original);
            const groupHeader =
              groupBy &&
              groupKey !== undefined &&
              (!prevRow || groupBy.key(prevRow.original) !== groupKey)
                ? groupBy.header(groupKey)
                : null;
            const detailCells = mobileMode
              ? row
                  .getAllCells()
                  .filter(
                    (cell) =>
                      cell.column.columnDef.meta?.mobile == null ||
                      cell.column.columnDef.meta.mobile === "secondary",
                  )
              : [];
            const isDetailOpen = mobileExpanded[row.id] === true;
            return (
              <React.Fragment key={row.id}>
                {groupHeader !== null && (
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableCell
                      colSpan={columns.length + (mobileMode ? 1 : 0)}
                      className="py-2 whitespace-normal"
                    >
                      {groupHeader}
                    </TableCell>
                  </TableRow>
                )}
                <TableRow
                  className={cn(onRowClick && "cursor-pointer")}
                  onClick={
                    onRowClick ? () => onRowClick(row.original) : undefined
                  }
                >
                  {mobileMode && (
                    <TableCell className="py-1 pr-0 md:hidden">
                      {detailCells.length > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMobileExpanded((prev) => ({
                              ...prev,
                              [row.id]: !isDetailOpen,
                            }));
                          }}
                          aria-expanded={isDetailOpen}
                          aria-label={
                            isDetailOpen ? "Ocultar detalle" : "Ver detalle"
                          }
                          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <ChevronDown
                            className={cn(
                              "size-4 transition-transform",
                              isDetailOpen && "rotate-180",
                            )}
                          />
                        </button>
                      )}
                    </TableCell>
                  )}
                  {row.getAllCells().map((cell) => {
                    const align = cell.column.columnDef.meta?.align;
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          align && ALIGN[align],
                          cell.column.columnDef.meta?.cellClassName,
                          mobileMode &&
                            cell.column.columnDef.meta?.mobile !== "primary" &&
                            "hidden md:table-cell",
                        )}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
                {mobileMode && isDetailOpen && detailCells.length > 0 && (
                  <TableRow className="md:hidden">
                    <TableCell
                      colSpan={columns.length + 1}
                      className="bg-muted/30 px-4 py-3 whitespace-normal"
                    >
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                        {detailCells.map((cell) => {
                          const header = cell.column.columnDef.header;
                          return (
                            <div key={cell.id} className="min-w-0">
                              <dt className="text-xs text-muted-foreground">
                                {typeof header === "string"
                                  ? header
                                  : cell.column.id}
                              </dt>
                              <dd className="text-sm break-words">
                                {flexRender(
                                  cell.column.columnDef.cell,
                                  cell.getContext(),
                                )}
                              </dd>
                            </div>
                          );
                        })}
                      </dl>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            );
          })
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
            Página {table.state.pagination.pageIndex + 1} de{" "}
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
        {footer}
        {pagination}
      </>
    );
  }
  return (
    <div className={cn("rounded-lg border bg-card", wrapperClassName)}>
      {tableEl}
      {footer}
      {pagination}
    </div>
  );
}
