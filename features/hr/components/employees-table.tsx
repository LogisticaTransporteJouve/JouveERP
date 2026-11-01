"use client";

import Link from "next/link";
import {
  Suspense,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";

import { ExportButton } from "@/components/export-button";
import {
  ListPending,
  ListSearch,
  ListToolbar,
} from "@/components/list-toolbar";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useUrlFilter } from "@/hooks/use-url-filter";
import type { Access } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useEmployeesSearchInfinite } from "../hooks/use-employees";
import {
  PAY_FREQUENCIES,
  PAY_FREQUENCY_LABEL,
  type Employee,
  type PayFrequency,
} from "../schema";
import { EditEmployeeDialog } from "./edit-employee-dialog";
import { NewEmployeeDialog } from "./new-employee-dialog";

const FREQUENCY_BADGE_TONE: Record<PayFrequency, string> = {
  semanal: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  mensual: "bg-muted text-muted-foreground dark:text-muted-foreground",
  mixto: "bg-muted text-muted-foreground dark:text-muted-foreground",
};

import { formatInteger } from "@/lib/format";

function formatMoney(value: number | string | null): string {
  if (value === null) return "—";
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) return "—";
  return `$ ${formatInteger(num)}`;
}

export function EmployeesTable({
  actorAccess,
  initialQuery,
  initialOnlyActive,
}: {
  actorAccess: Access;
  initialQuery: string;
  initialOnlyActive: boolean;
}) {
  const [queryInput, setQueryInput] = useState(initialQuery);
  const [onlyActive, setOnlyActive] = useState(initialOnlyActive);

  const debouncedQuery = useDebouncedValue(queryInput.trim(), 250);
  const deferredQuery = useDeferredValue(debouncedQuery);
  const deferredOnlyActive = useDeferredValue(onlyActive);
  const setUrlFilters = useUrlFilter();

  const canWrite = userCan(actorAccess, "hr:write");

  useEffect(() => {
    setUrlFilters({
      q: debouncedQuery || null,
      inactive: onlyActive ? null : "1",
    });
  }, [debouncedQuery, onlyActive, setUrlFilters]);

  const isFiltered = queryInput.trim() !== "" || !onlyActive;
  const pending =
    deferredQuery !== debouncedQuery || deferredOnlyActive !== onlyActive;

  return (
    <>
      <ListToolbar
        isFiltered={isFiltered}
        onClear={() => {
          setQueryInput("");
          setOnlyActive(true);
        }}
        actions={
          <>
            <ExportButton resource="employees" />
            {canWrite && <NewEmployeeDialog />}
          </>
        }
      >
        <ListSearch
          placeholder="Buscar por apellido y nombre o CUIL"
          value={queryInput}
          onChange={setQueryInput}
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={onlyActive}
            onCheckedChange={(value) => setOnlyActive(value === true)}
          />
          Solo activos
        </label>
      </ListToolbar>

      <div className="mt-4">
        <Suspense fallback={<DataTable columns={[]} data={[]} isLoading />}>
          <ListPending pending={pending}>
            <EmployeesTableRows
              query={deferredQuery}
              onlyActive={deferredOnlyActive}
              canWrite={canWrite}
            />
          </ListPending>
        </Suspense>
      </div>
    </>
  );
}

function EmployeesTableRows({
  query,
  onlyActive,
  canWrite,
}: {
  query: string;
  onlyActive: boolean;
  canWrite: boolean;
}) {
  const {
    items: employees,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useEmployeesSearchInfinite({ query, onlyActive });

  const sentinelRef = useIntersectionObserver<HTMLDivElement>(
    () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    { rootMargin: "200px", enabled: hasNextPage && !isFetchingNextPage },
  );

  const columns = useMemo<ColumnDef<Employee>[]>(
    () => [
      {
        id: "legal_name",
        header: "Apellido y nombre",
        enableSorting: false,
        cell: ({ row }) => {
          const employee = row.original;
          return (
            <div className={employee.is_active ? undefined : "opacity-60"}>
              <Link
                href={`/employees/${employee.id}`}
                className="font-medium hover:underline"
              >
                {employee.legal_name}
              </Link>
              {employee.is_monotributo && (
                <Badge variant="outline" className="ml-2 text-xs">
                  Monotributo
                </Badge>
              )}
            </div>
          );
        },
      },
      {
        id: "position",
        header: "Posición",
        enableSorting: false,
        meta: { cellClassName: "text-sm text-muted-foreground" },
        cell: ({ row }) => (
          <span className={row.original.is_active ? undefined : "opacity-60"}>
            {row.original.position ?? "—"}
          </span>
        ),
      },
      {
        id: "pay_frequency",
        header: "Frecuencia",
        enableSorting: false,
        cell: ({ row }) => (
          <Badge
            variant="secondary"
            className={cn(
              FREQUENCY_BADGE_TONE[row.original.pay_frequency],
              !row.original.is_active && "opacity-60",
            )}
          >
            {PAY_FREQUENCY_LABEL[row.original.pay_frequency]}
          </Badge>
        ),
      },
      {
        id: "base_salary",
        header: "Sueldo base",
        enableSorting: false,
        meta: { align: "right", cellClassName: "font-mono text-sm" },
        cell: ({ row }) => (
          <span className={row.original.is_active ? undefined : "opacity-60"}>
            {formatMoney(row.original.base_salary)}
          </span>
        ),
      },
      {
        id: "viatico_monthly",
        header: "Viático",
        enableSorting: false,
        meta: { align: "right", cellClassName: "font-mono text-sm" },
        cell: ({ row }) => (
          <span className={row.original.is_active ? undefined : "opacity-60"}>
            {formatMoney(row.original.viatico_monthly)}
          </span>
        ),
      },
      {
        id: "is_active",
        header: "Estado",
        enableSorting: false,
        cell: ({ row }) => {
          const employee = row.original;
          return employee.is_active ? (
            <span className="text-sm text-muted-foreground dark:text-muted-foreground">
              Activo
            </span>
          ) : (
            <span className="text-sm text-muted-foreground opacity-60">
              Inactivo
              {employee.termination_date
                ? ` (${formatArgentineDate(employee.termination_date)})`
                : ""}
            </span>
          );
        },
      },
      {
        id: "hire_date",
        header: "Ingreso",
        enableSorting: false,
        meta: { cellClassName: "text-sm text-muted-foreground" },
        cell: ({ row }) => (
          <span className={row.original.is_active ? undefined : "opacity-60"}>
            {formatArgentineDate(row.original.hire_date)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "Acciones",
        enableSorting: false,
        meta: { align: "right", headerClassName: "w-24" },
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            {canWrite && <EditEmployeeDialog employee={row.original} />}
          </div>
        ),
      },
    ],
    [canWrite],
  );

  return (
    <DataTable
      columns={columns}
      data={employees}
      getRowId={(employee) => employee.id}
      emptyMessage="No hay empleados que coincidan."
      footer={
        hasNextPage ? (
          <div
            ref={sentinelRef}
            className="py-4 text-center text-xs text-muted-foreground"
          >
            {isFetchingNextPage ? "Cargando más…" : ""}
          </div>
        ) : null
      }
    />
  );
}

export { PAY_FREQUENCIES };
