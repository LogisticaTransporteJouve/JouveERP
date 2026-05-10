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

import { useClientsSearchInfinite } from "../hooks/use-clients";
import {
  IVA_CONDITION_LABEL,
  type IvaCondition,
} from "../schema";
import { DeleteClientDialog } from "./delete-client-dialog";
import { EditClientDialog } from "./edit-client-dialog";
import { NewClientDialog } from "./new-client-dialog";

const IVA_BADGE_TONE: Record<IvaCondition, string> = {
  responsable_inscripto: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  monotributo: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  exento: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  consumidor_final: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  no_categorizado: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

export function ClientsTable({
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
  // useDeferredValue keeps the previous Suspense subtree visible while the
  // new (query, onlyActive) combo is fetching, instead of throwing back to
  // the top-level fallback on every keystroke.
  const deferredQuery = useDeferredValue(debouncedQuery);
  const deferredOnlyActive = useDeferredValue(onlyActive);
  const setUrlFilters = useUrlFilter();

  const canWrite = userCan(actorRoles, "clients:write");

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
          placeholder="Buscar por razón social, nombre fantasía o CUIT"
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
            <NewClientDialog />
          </div>
        )}
      </div>

      <div className="mt-4 rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Razón social</TableHead>
              <TableHead>CUIT</TableHead>
              <TableHead>Condición IVA</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Actualizado</TableHead>
              <TableHead className="w-24 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <Suspense fallback={<ClientsTableSkeletonRows />}>
            <ClientsTableRows
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

function ClientsTableRows({
  query,
  onlyActive,
  canWrite,
}: {
  query: string;
  onlyActive: boolean;
  canWrite: boolean;
}) {
  const {
    items: clients,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useClientsSearchInfinite({ query, onlyActive });

  const sentinelRef = useIntersectionObserver<HTMLTableRowElement>(
    () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    { rootMargin: "200px", enabled: hasNextPage && !isFetchingNextPage },
  );

  if (clients.length === 0) {
    return (
      <TableBody>
        <TableRow>
          <TableCell
            colSpan={6}
            className="py-10 text-center text-sm text-muted-foreground"
          >
            No hay clientes que coincidan.
          </TableCell>
        </TableRow>
      </TableBody>
    );
  }

  return (
    <TableBody>
      {clients.map((client) => (
        <TableRow
          key={client.id}
          className={!client.is_active ? "opacity-60" : undefined}
        >
          <TableCell>
            <Link
              href={`/clientes/${client.id}`}
              className="font-medium hover:underline"
            >
              {client.legal_name}
            </Link>
            {client.display_name && (
              <div className="text-xs text-muted-foreground">
                {client.display_name}
              </div>
            )}
          </TableCell>
          <TableCell className="font-mono text-xs">{client.cuit}</TableCell>
          <TableCell>
            <Badge
              variant="secondary"
              className={IVA_BADGE_TONE[client.iva_condition]}
            >
              {IVA_CONDITION_LABEL[client.iva_condition]}
            </Badge>
          </TableCell>
          <TableCell>
            {client.is_active ? (
              <span className="text-sm text-emerald-600 dark:text-emerald-400">
                Activo
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">Inactivo</span>
            )}
          </TableCell>
          <TableCell className="text-sm text-muted-foreground">
            {formatArgentineDate(client.updated_at)}
          </TableCell>
          <TableCell>
            <div className="flex items-center justify-end gap-1">
              {canWrite && <EditClientDialog client={client} />}
              {canWrite && <DeleteClientDialog client={client} />}
            </div>
          </TableCell>
        </TableRow>
      ))}
      {hasNextPage && (
        <TableRow ref={sentinelRef}>
          <TableCell
            colSpan={6}
            className="py-3 text-center text-xs text-muted-foreground"
          >
            {isFetchingNextPage ? "Cargando más…" : ""}
          </TableCell>
        </TableRow>
      )}
    </TableBody>
  );
}

function ClientsTableSkeletonRows() {
  return (
    <TableBody>
      {Array.from({ length: 6 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: 6 }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );
}
