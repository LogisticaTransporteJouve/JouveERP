"use client";

import Link from "next/link";
import { useEffect, useState, type ChangeEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useInfinitePagedQuery } from "@/hooks/use-infinite-paged-query";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useUrlFilter } from "@/hooks/use-url-filter";
import type { Role } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate } from "@/lib/format";

import { searchClientsAction } from "../actions/clients-actions";
import type { Page } from "@/hooks/use-infinite-paged-query";
import {
  IVA_CONDITION_LABEL,
  type Client,
  type IvaCondition,
} from "../schema";
import { DeleteClientDialog } from "./delete-client-dialog";
import { EditClientDialog } from "./edit-client-dialog";
import { NewClientDialog } from "./new-client-dialog";

const PAGE_SIZE = 50;

const IVA_BADGE_TONE: Record<IvaCondition, string> = {
  responsable_inscripto: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  monotributo: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  exento: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  consumidor_final: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  no_categorizado: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

async function fetchPage(
  query: string,
  onlyActive: boolean,
  offset: number,
): Promise<Page<Client>> {
  const result = await searchClientsAction({
    query,
    onlyActive,
    offset,
    limit: PAGE_SIZE,
  });
  if (!result.ok) throw new Error(result.error);
  return { items: result.data.clients, nextOffset: result.data.nextOffset };
}

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
  const setUrlFilters = useUrlFilter();

  const canWrite = userCan(actorRoles, "clients:write");

  const {
    items: clients,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
    refetch,
  } = useInfinitePagedQuery<Client>({
    queryKey: ["clients", { query: debouncedQuery, onlyActive }],
    queryFn: (offset) => fetchPage(debouncedQuery, onlyActive, offset),
  });

  // Sync URL with applied filters so the page is shareable.
  useEffect(() => {
    setUrlFilters({
      q: debouncedQuery || null,
      inactive: onlyActive ? null : "1",
    });
  }, [debouncedQuery, onlyActive, setUrlFilters]);

  const sentinelRef = useIntersectionObserver<HTMLDivElement>(
    () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    { rootMargin: "200px", enabled: hasNextPage && !isFetchingNextPage },
  );

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
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Cargando…
                </TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-sm text-destructive"
                >
                  {error instanceof Error ? error.message : "Error al cargar."}{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void refetch()}
                  >
                    Reintentar
                  </button>
                </TableCell>
              </TableRow>
            ) : clients.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No hay clientes que coincidan.
                </TableCell>
              </TableRow>
            ) : (
              clients.map((client) => (
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
                  <TableCell className="font-mono text-xs">
                    {client.cuit}
                  </TableCell>
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
                      <span className="text-sm text-muted-foreground">
                        Inactivo
                      </span>
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
              ))
            )}
          </TableBody>
        </Table>
        <div ref={sentinelRef} className="h-px" />
        {isFetchingNextPage && (
          <div className="border-t py-3 text-center text-xs text-muted-foreground">
            Cargando más…
          </div>
        )}
      </div>
    </>
  );
}
