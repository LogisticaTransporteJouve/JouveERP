"use client";

import Link from "next/link";
import {
  Suspense,
  useDeferredValue,
  useEffect,
  useState,
  type ChangeEvent,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useUrlFilter } from "@/hooks/use-url-filter";
import type { Role } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate } from "@/lib/format";

import { useEmployeesSearchInfinite } from "../hooks/use-employees";
import {
  PAY_FREQUENCIES,
  PAY_FREQUENCY_LABEL,
  type PayFrequency,
} from "../schema";
import { EditEmployeeDialog } from "./edit-employee-dialog";
import { NewEmployeeDialog } from "./new-employee-dialog";

const FREQUENCY_BADGE_TONE: Record<PayFrequency, string> = {
  semanal: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  mensual: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  mixto: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

const ARS = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function formatMoney(value: number | string | null): string {
  if (value === null) return "—";
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) return "—";
  return `$ ${ARS.format(num)}`;
}

export function EmployeesTable({
  actorRoles,
  initialQuery,
  initialOnlyActive,
}: {
  actorRoles: Role[];
  initialQuery: string;
  initialOnlyActive: boolean;
}) {
  const [queryInput, setQueryInput] = useState(initialQuery);
  const [onlyActive, setOnlyActive] = useState(initialOnlyActive);

  const debouncedQuery = useDebouncedValue(queryInput.trim(), 250);
  const deferredQuery = useDeferredValue(debouncedQuery);
  const deferredOnlyActive = useDeferredValue(onlyActive);
  const setUrlFilters = useUrlFilter();

  const canWrite = userCan(actorRoles, "hr:write");

  useEffect(() => {
    setUrlFilters({
      q: debouncedQuery || null,
      inactive: onlyActive ? null : "1",
    });
  }, [debouncedQuery, onlyActive, setUrlFilters]);

  function onSearchChange(event: ChangeEvent<HTMLInputElement>) {
    setQueryInput(event.target.value);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Buscar por apellido y nombre o CUIL"
          value={queryInput}
          onChange={onSearchChange}
          className="max-w-md"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={onlyActive}
            onCheckedChange={(value) => setOnlyActive(value === true)}
          />
          Solo activos
        </label>
        {canWrite && (
          <div className="ml-auto">
            <NewEmployeeDialog />
          </div>
        )}
      </div>

      <div className="mt-4 rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Apellido y nombre</TableHead>
              <TableHead>Posición</TableHead>
              <TableHead>Frecuencia</TableHead>
              <TableHead className="text-right">Sueldo base</TableHead>
              <TableHead className="text-right">Viático</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Ingreso</TableHead>
              <TableHead className="w-24 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <Suspense fallback={<EmployeesTableSkeletonRows />}>
            <EmployeesTableRows
              query={deferredQuery}
              onlyActive={deferredOnlyActive}
              canWrite={canWrite}
            />
          </Suspense>
        </Table>
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

  const sentinelRef = useIntersectionObserver<HTMLTableRowElement>(
    () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    { rootMargin: "200px", enabled: hasNextPage && !isFetchingNextPage },
  );

  if (employees.length === 0) {
    return (
      <TableBody>
        <TableRow>
          <TableCell
            colSpan={8}
            className="py-10 text-center text-sm text-muted-foreground"
          >
            No hay empleados que coincidan.
          </TableCell>
        </TableRow>
      </TableBody>
    );
  }

  return (
    <TableBody>
      {employees.map((employee) => (
        <TableRow
          key={employee.id}
          className={!employee.is_active ? "opacity-60" : undefined}
        >
          <TableCell>
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
          </TableCell>
          <TableCell className="text-sm text-muted-foreground">
            {employee.position ?? "—"}
          </TableCell>
          <TableCell>
            <Badge
              variant="secondary"
              className={FREQUENCY_BADGE_TONE[employee.pay_frequency]}
            >
              {PAY_FREQUENCY_LABEL[employee.pay_frequency]}
            </Badge>
          </TableCell>
          <TableCell className="text-right font-mono text-sm">
            {formatMoney(employee.base_salary)}
          </TableCell>
          <TableCell className="text-right font-mono text-sm">
            {formatMoney(employee.viatico_monthly)}
          </TableCell>
          <TableCell>
            {employee.is_active ? (
              <span className="text-sm text-emerald-600 dark:text-emerald-400">
                Activo
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">
                Inactivo
                {employee.termination_date
                  ? ` (${formatArgentineDate(employee.termination_date)})`
                  : ""}
              </span>
            )}
          </TableCell>
          <TableCell className="text-sm text-muted-foreground">
            {formatArgentineDate(employee.hire_date)}
          </TableCell>
          <TableCell>
            <div className="flex items-center justify-end gap-1">
              {canWrite && <EditEmployeeDialog employee={employee} />}
            </div>
          </TableCell>
        </TableRow>
      ))}
      {hasNextPage && (
        <TableRow ref={sentinelRef}>
          <TableCell
            colSpan={8}
            className="py-3 text-center text-xs text-muted-foreground"
          >
            {isFetchingNextPage ? "Cargando más…" : ""}
          </TableCell>
        </TableRow>
      )}
    </TableBody>
  );
}

function EmployeesTableSkeletonRows() {
  return (
    <TableBody>
      {Array.from({ length: 6 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: 8 }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );
}

export { PAY_FREQUENCIES };
